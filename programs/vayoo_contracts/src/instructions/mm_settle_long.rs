//libraries
use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};
use std::cmp::min;
//local imports
use crate::states::contract_state::ContractState;
pub fn handle(ctx: Context<MmSettleLong>, amount_to_redeem: u64) -> Result<()> {
    let contract_state = &ctx.accounts.contract_state;

    require!(contract_state.is_settling, ErrorCode::NotSettling);

    let contract_signer_seeds: &[&[&[u8]]] = &[&[
        ctx.accounts.contract_state.name.as_bytes(),
        ctx.accounts.contract_state.lcontract_mint.as_ref(),
        ctx.accounts.contract_state.authority.as_ref(),
        &[ctx.accounts.contract_state.bump],
    ]];

    //for this condition, we should also check the amounts of tokens in the token accounts to double check

    let adapted_contract_limiting_amplitude = contract_state
        .limiting_amplitude
        .checked_mul(contract_state.pyth_price_multiplier)
        .unwrap();

    let midrange = contract_state
        .limiting_amplitude
        .checked_mul(contract_state.pyth_price_multiplier)
        .unwrap()
        .checked_div(2)
        .unwrap();

    let lower_bound = contract_state.starting_price.checked_sub(midrange).unwrap();
    let upper_bound = contract_state.starting_price + midrange;
    let mut final_price = contract_state.ending_price;
    if final_price > upper_bound {
        final_price = upper_bound;
    }
    if final_price < lower_bound {
        final_price = lower_bound;
    }

    let mut pnl_lcontract = final_price.checked_sub(lower_bound).unwrap();
    pnl_lcontract = min(pnl_lcontract, adapted_contract_limiting_amplitude);
    msg!(&format!("pnl_lcontract  {}", pnl_lcontract));
    let gains_longer = amount_to_redeem
        .checked_mul(pnl_lcontract)
        .unwrap()
        .checked_div(contract_state.pyth_price_multiplier)
        .unwrap();

    let cpi_accounts_transfer_pnl_long = Transfer {
        from: ctx.accounts.escrow_vault_collateral.to_account_info(),
        to: ctx.accounts.mm_collateral_wallet_ata.to_account_info(),
        authority: ctx.accounts.contract_state.to_account_info(),
    };

    let cpi_program_redeem_pnl_long = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(
        cpi_program_redeem_pnl_long,
        cpi_accounts_transfer_pnl_long,
        contract_signer_seeds,
    );
    token::transfer(cpi_ctx, gains_longer)?;

    let cpi_accounts = Burn {
        mint: ctx.accounts.lcontract_mint.to_account_info(),
        from: ctx.accounts.mm_lcontract_ata.to_account_info(),
        authority: ctx.accounts.user_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    token::burn(cpi_ctx, amount_to_redeem)?;
    let local_pyt_multiplier = contract_state.pyth_price_multiplier;
    let contract_state_m = &mut ctx.accounts.contract_state;
    contract_state_m.global_current_issued_lcontract = contract_state_m
        .global_current_issued_lcontract
        .checked_sub(amount_to_redeem)
        .unwrap();
    contract_state_m.global_current_locked_usdc = contract_state_m
        .global_current_locked_usdc
        .checked_sub(gains_longer)
        .unwrap();

    let global_final_issued_contract = contract_state_m.global_current_issued_lcontract;

    let global_needed_collateral = global_final_issued_contract
        .checked_mul(pnl_lcontract)
        .unwrap()
        .checked_div(local_pyt_multiplier)
        .unwrap();

    if global_needed_collateral > contract_state_m.global_current_locked_usdc {
        return err!(ErrorCode::PlatformUnhealthy);
    }
    Ok(())
}

#[derive(Accounts)]
pub struct MmSettleLong<'info> {
    // Super User
    #[account(mut)]
    pub user_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [contract_state.name.as_bytes(), contract_state.lcontract_mint.key().as_ref(), contract_state.authority.key().as_ref()],
        bump,

    )]
    pub contract_state: Box<Account<'info, ContractState>>,

    #[account(mut)]
    pub mm_collateral_wallet_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub mm_lcontract_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub escrow_vault_collateral: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub lcontract_mint: Box<Account<'info, Mint>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    // Programs and Sysvars
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}
