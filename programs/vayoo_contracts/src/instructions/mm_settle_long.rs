//libraries
use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::states::UserState;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};
use std::cmp::max;
use std::cmp::min;
//local imports
use crate::states::contract_state::ContractState;
pub fn handle(ctx: Context<MmSettleLong>, amount_to_redeem: u64) -> Result<()> {
    let contract_state = &ctx.accounts.contract_state;

    let contract_signer_seeds: &[&[&[u8]]] = &[&[
        ctx.accounts.contract_state.name.as_bytes(),
        ctx.accounts.contract_state.lcontract_mint.as_ref(),
        ctx.accounts.contract_state.authority.as_ref(),
        &[ctx.accounts.contract_state.bump],
    ]];

    //for this condition, we should also check the amounts of tokens in the token accounts to double check

    let midrange = contract_state
        .limiting_amplitude
        .checked_div(2)
        .unwrap()
        .checked_mul(contract_state.pyth_price_multiplier)
        .unwrap();
    let mut pnl_lcontract = contract_state.starting_price.checked_sub(midrange).unwrap();
    let real_ending_price = max(pnl_lcontract, contract_state.ending_price);
    pnl_lcontract = real_ending_price.checked_sub(pnl_lcontract).unwrap();
    pnl_lcontract = min(pnl_lcontract, contract_state.limiting_amplitude);

    let gains_longer = amount_to_redeem
        .checked_mul(pnl_lcontract)
        .unwrap()
        .checked_div(contract_state.pyth_price_multiplier)
        .unwrap();

    let cpi_accounts_transfer_pnl_long = Transfer {
        from: ctx.accounts.escrow_vault_collateral.to_account_info(),
        to: ctx.accounts.vault_free_collateral_ata.to_account_info(),
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
    #[account(
        mut,
        token::mint = contract_state.collateral_mint,
        token::authority = user_state
    )]
    pub vault_free_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub mm_lcontract_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub escrow_vault_collateral: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [contract_state.key().as_ref(), user_authority.key().as_ref()],
        bump,
        constraint = user_authority.key() == user_state.authority @ ErrorCode::Unauthorized,
        constraint = user_state.contract_account == contract_state.key() @ErrorCode::Invalid
    )]
    pub user_state: Box<Account<'info, UserState>>,

    #[account(mut)]
    pub lcontract_mint: Box<Account<'info, Mint>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    // Programs and Sysvars
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}
