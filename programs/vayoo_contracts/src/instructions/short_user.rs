use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};
use whirlpools::{self, state::*};

use crate::states::ContractState;
use crate::{errors::ErrorCode, states::UserState};

pub fn handle(
    ctx: Context<ShortUser>,
    amount: u64,
    other_amount_threshold: u64,
    sqrt_price_limit: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
) -> Result<()> {

    let _lcontract_bal_before = ctx.accounts.vault_lcontract_ata.amount;

    let token_account_a;
    let token_account_b;

    let user_state = &ctx.accounts.user_state;
    
    if user_state.scontract_sold_as_user > 0 {
       return err!(ErrorCode::CloseLongBeforeShort);
    }
    let signer_seeds: &[&[&[u8]]] = &[&[
        user_state.contract_account.as_ref(),
        user_state.authority.as_ref(),
        &[user_state.bump],
    ]];

    let contract_signer_seeds: &[&[&[u8]]] = &[&[
        ctx.accounts.contract_state.name.as_bytes(),
        ctx.accounts.contract_state.lcontract_mint.as_ref(),
        ctx.accounts.contract_state.authority.as_ref(),
        &[ctx.accounts.contract_state.bump],
    ]];

    //Mint the underlying on the token account of the USER
    let cpi_accounts = MintTo {
        mint: ctx.accounts.lcontract_mint.to_account_info(),
        to: ctx.accounts.vault_lcontract_ata.to_account_info(),
        authority: ctx.accounts.contract_state.to_account_info(),
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, contract_signer_seeds);
    token::mint_to(cpi_ctx, amount)?;

    //Mint the underlying on the token account of the USER
    let cpi_accounts = MintTo {
        mint: ctx.accounts.scontract_mint.to_account_info(),
        to: ctx.accounts.vault_locked_scontract_ata.to_account_info(),
        authority: ctx.accounts.contract_state.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, contract_signer_seeds);
    token::mint_to(cpi_ctx, amount)?;

    // Save the amount stored in the tas
    let vault1 = ctx.accounts.vault_lcontract_ata.to_account_info();
    let vault2 = ctx.accounts.vault_locked_collateral_ata.to_account_info();
    let _vault1_before = token::accessor::amount(&vault1)?;
    let vault2_before = token::accessor::amount(&vault2)?;

    // This check is necessary, since orca uses cardinal ordering for the mints, and the pool can be either A/B or B/A
    if ctx.accounts.vault_locked_collateral_ata.mint == ctx.accounts.token_vault_a.mint {
        token_account_a = &ctx.accounts.vault_locked_collateral_ata;
        token_account_b = &ctx.accounts.vault_lcontract_ata;
    } else {
        token_account_a = &ctx.accounts.vault_lcontract_ata;
        token_account_b = &ctx.accounts.vault_locked_collateral_ata;
    }
    let cpi_program = ctx.accounts.whirlpool_program.to_account_info();

    let cpi_accounts = whirlpools::cpi::accounts::Swap {
        whirlpool: ctx.accounts.whirlpool.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        token_authority: user_state.to_account_info(),
        token_owner_account_a: token_account_a.to_account_info(),
        token_vault_a: ctx.accounts.token_vault_a.to_account_info(),
        token_owner_account_b: token_account_b.to_account_info(),
        token_vault_b: ctx.accounts.token_vault_b.to_account_info(),
        tick_array0: ctx.accounts.tick_array_0.to_account_info(),
        tick_array1: ctx.accounts.tick_array_1.to_account_info(),
        tick_array2: ctx.accounts.tick_array_2.to_account_info(),
        oracle: ctx.accounts.oracle.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

    // execute CPI
    msg!("CPI: whirlpool swap instruction");
    whirlpools::cpi::swap(
        cpi_ctx,
        amount,
        other_amount_threshold,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
    )?;

    let vault11 = ctx.accounts.vault_lcontract_ata.to_account_info();
    let vault22 = ctx.accounts.vault_locked_collateral_ata.to_account_info();
    let _vault1_after = token::accessor::amount(&vault11)?;
    let vault2_after = token::accessor::amount(&vault22)?;

    let mut delta = 0;

    if vault2_after > vault2_before {
        delta = vault2_after.checked_sub(vault2_before).unwrap();
    }

    //Adapt the amt to lock
    let mut amount_to_send_tolocked = ctx.accounts.contract_state.limiting_amplitude;
    amount_to_send_tolocked = amount_to_send_tolocked.checked_mul(amount).unwrap();

    amount_to_send_tolocked = amount_to_send_tolocked.checked_sub(delta).unwrap();
    let cpi_accounts_transfer_to_locked = Transfer {
        from: ctx.accounts.vault_free_collateral_ata.to_account_info(),
        to: ctx.accounts.vault_locked_collateral_ata.to_account_info(),
        authority: ctx.accounts.user_state.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx =
        CpiContext::new_with_signer(cpi_program, cpi_accounts_transfer_to_locked, signer_seeds);
    token::transfer(cpi_ctx, amount_to_send_tolocked)?;
    let amplitude=ctx.accounts.contract_state.limiting_amplitude;
    let user_state = &mut ctx.accounts.user_state;
    // Update User State
    user_state.usdc_collateral_locked_as_user += amount
        .checked_mul(amplitude)
        .unwrap();
    user_state.scontract_sold_as_user += amount;
    user_state.contract_position_net = user_state.contract_position_net.checked_sub(amount as i64).unwrap() ;

    let contract_state = &mut ctx.accounts.contract_state;
    contract_state.global_current_locked_usdc+= amount
    .checked_mul(amplitude)
    .unwrap();
    contract_state.global_current_issued_lcontract+= amount;


    //Making sure the user vault is well collateralized
    let vault_final_scontract = ctx.accounts.vault_locked_scontract_ata.to_account_info();
    let vault_final_locked_usdc = ctx.accounts.vault_locked_collateral_ata.to_account_info();
    let vault_final_scontract_value = token::accessor::amount(&vault_final_scontract)?;
    let vault_final_locked_usdc_value = token::accessor::amount(&vault_final_locked_usdc)?;
    let needed_collateral = vault_final_scontract_value
        .checked_mul(ctx.accounts.contract_state.limiting_amplitude)
        .unwrap();
    if needed_collateral > vault_final_locked_usdc_value {
        return err!(ErrorCode::ShortLeaveUnhealthy);
    }

    Ok(())
}

#[derive(Accounts)]
pub struct ShortUser<'info> {
    #[account(mut)]
    pub user_authority: Signer<'info>,
    #[account[
        mut,
        seeds = [contract_state.name.as_ref(), contract_state.lcontract_mint.key().as_ref(), contract_state.authority.key().as_ref()],
        bump
    ]]
    pub contract_state: Box<Account<'info, ContractState>>,
    #[account(
    mut,
    seeds = [contract_state.key().as_ref(), user_authority.key().as_ref()],
    bump,
    constraint = user_authority.key() == user_state.authority.key() @ ErrorCode::Unauthorized,
    constraint = user_state.contract_account == contract_state.key() @ErrorCode::Invalid
)]
    pub user_state: Box<Account<'info, UserState>>,

    #[account(
  mut,
  token::mint = contract_state.collateral_mint,
  token::authority = user_state,
  constraint = (vault_free_collateral_ata.mint == whirlpool.token_mint_a) || (vault_free_collateral_ata.mint == whirlpool.token_mint_b)
)]
    pub vault_free_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
  mut,
  token::mint = contract_state.collateral_mint,
  token::authority = user_state,
  constraint = (vault_free_collateral_ata.mint == whirlpool.token_mint_a) || (vault_free_collateral_ata.mint == whirlpool.token_mint_b)
)]
    pub vault_locked_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
  mut,
  token::mint = contract_state.lcontract_mint,
  token::authority = user_state,
  constraint = (vault_lcontract_ata.mint == whirlpool.token_mint_a) || (vault_lcontract_ata.mint == whirlpool.token_mint_b)
)]
    pub vault_lcontract_ata: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault_locked_scontract_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub lcontract_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub scontract_mint: Box<Account<'info, Mint>>,

    pub whirlpool_program: Program<'info, whirlpools::program::Whirlpool>,

    #[account(mut)]
    pub whirlpool: Box<Account<'info, Whirlpool>>,

    #[account(mut, address = whirlpool.token_vault_a)]
    pub token_vault_a: Box<Account<'info, TokenAccount>>,

    #[account(mut, address = whirlpool.token_vault_b)]
    pub token_vault_b: Box<Account<'info, TokenAccount>>,

    #[account(mut, has_one = whirlpool)]
    pub tick_array_0: AccountLoader<'info, TickArray>,

    #[account(mut, has_one = whirlpool)]
    pub tick_array_1: AccountLoader<'info, TickArray>,

    #[account(mut, has_one = whirlpool)]
    pub tick_array_2: AccountLoader<'info, TickArray>,

    /// CHECK: checked by whirlpool_program
    pub oracle: UncheckedAccount<'info>,
    #[account(address = token::ID)]
    pub token_program: Program<'info, Token>,
}
