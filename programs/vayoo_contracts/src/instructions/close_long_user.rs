use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use whirlpools::{self, state::*};

use crate::states::ContractState;
use crate::{errors::ErrorCode, states::UserState};

pub fn handle(
    ctx: Context<CloseLongUser>,
    amount: u64,
    other_amount_threshold: u64,
    sqrt_price_limit: u128,
    amount_specified_is_input: bool,
    a_to_b: bool,
) -> Result<()> {
    let lcontract_bal_before = ctx.accounts.vault_lcontract_ata.amount;
    let free_usdc_bal_before = ctx.accounts.vault_free_collateral_ata.amount;
    
    let token_account_a;
    let token_account_b;

    let user_state = &mut ctx.accounts.user_state;

    require!(
        amount <= user_state.lcontract_bought_as_user,
        ErrorCode::ClosePositionBiggerThanOpened
    );

    let signer_seeds: &[&[&[u8]]] = &[&[
        user_state.contract_account.as_ref(),
        user_state.authority.as_ref(),
        &[user_state.bump],
    ]];

    // This check is necessary, since orca uses cardinal ordering for the mints, and the pool can be either A/B or B/A
    if ctx.accounts.vault_free_collateral_ata.mint == ctx.accounts.token_vault_a.mint {
        token_account_b = &ctx.accounts.vault_lcontract_ata;
        token_account_a = &ctx.accounts.vault_free_collateral_ata;
    } else {
        token_account_b = &ctx.accounts.vault_free_collateral_ata;
        token_account_a = &ctx.accounts.vault_lcontract_ata;
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

    // Updating State
    ctx.accounts.vault_lcontract_ata.reload()?;
    let lcontract_bal_after = ctx.accounts.vault_lcontract_ata.amount;
    let amount_swapped = lcontract_bal_before - lcontract_bal_after;


    ctx.accounts.vault_free_collateral_ata.reload()?;
    let free_usdc_bal_after = ctx.accounts.vault_free_collateral_ata.amount;

    let usdc_gathered = free_usdc_bal_after.checked_sub(free_usdc_bal_before).unwrap();

    user_state.usdc_free=user_state.usdc_free+usdc_gathered;
    user_state.contract_position_net = user_state.contract_position_net.checked_sub(amount_swapped as i64).unwrap();
    user_state.lcontract_bought_as_user = user_state.lcontract_bought_as_user.checked_sub(amount_swapped).unwrap();

    
    if (user_state.lcontract_bought_as_user != lcontract_bal_after ){
        return err!(ErrorCode::ErrorAccounting);
    }

    Ok(())
}

#[derive(Accounts)]
pub struct CloseLongUser<'info> {
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
  token::mint = contract_state.lcontract_mint,
  token::authority = user_state,
  constraint = (vault_lcontract_ata.mint == whirlpool.token_mint_a) || (vault_lcontract_ata.mint == whirlpool.token_mint_b)
)]
    pub vault_lcontract_ata: Box<Account<'info, TokenAccount>>,

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
