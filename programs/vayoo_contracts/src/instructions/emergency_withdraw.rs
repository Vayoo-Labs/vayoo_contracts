//libraries
use anchor_lang::prelude::*;

use anchor_spl::token::{self, Token, TokenAccount, Transfer};

//local imports
use crate::states::contract_state::ContractState;
pub fn handle(ctx: Context<EmergencyWithdraw>) -> Result<()> {
    let contract_signer_seeds: &[&[&[u8]]] = &[&[
        ctx.accounts.contract_state.name.as_bytes(),
        ctx.accounts.contract_state.lcontract_mint.as_ref(),
        ctx.accounts.contract_state.authority.as_ref(),
        &[ctx.accounts.contract_state.bump],
    ]];

    let cpi_accounts_transfer_pnl_long = Transfer {
        from: ctx.accounts.escrow_vault_collateral.to_account_info(),
        to: ctx.accounts.user_collateral_wallet_ata.to_account_info(),
        authority: ctx.accounts.contract_state.to_account_info(),
    };

    let cpi_program_redeem_pnl_long = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(
        cpi_program_redeem_pnl_long,
        cpi_accounts_transfer_pnl_long,
        contract_signer_seeds,
    );
    token::transfer(cpi_ctx, ctx.accounts.escrow_vault_collateral.amount)?;

    Ok(())
}

#[derive(Accounts)]
pub struct EmergencyWithdraw<'info> {
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
    pub user_collateral_wallet_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub escrow_vault_collateral: Box<Account<'info, TokenAccount>>,

    // Programs and Sysvars
    pub token_program: Program<'info, Token>,
}
