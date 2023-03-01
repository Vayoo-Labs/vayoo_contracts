//libraries
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::errors::ErrorCode;

//local imports
use crate::states::contract_state::ContractState;
use crate::states::user_state::UserState;

pub fn handle(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
    let user_state = &mut ctx.accounts.user_state;
    let contract_state = &mut ctx.accounts.contract_state;

    let signer_seeds: &[&[&[u8]]] = &[&[
        user_state.contract_account.as_ref(),
        user_state.authority.as_ref(),
        &[user_state.bump],
    ]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault_free_collateral_ata.to_account_info(),
        to: ctx.accounts.user_collateral_ata.to_account_info(),
        authority: user_state.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, amount)?;

    // Update State
    user_state.usdc_deposited -= amount;
    contract_state.current_tvl_usdc -= amount;

    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    #[account(mut)]
    pub user_authority: Signer<'info>,

    #[account(
        mut, 
        associated_token::mint = contract_state.collateral_mint,
        associated_token::authority = user_authority
    )]
    pub user_collateral_ata: Box<Account<'info, TokenAccount>>,
    #[account(
        mut, 
        token::mint = contract_state.collateral_mint,
        token::authority = user_state
    )]
    pub vault_free_collateral_ata: Box<Account<'info, TokenAccount>>,
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

    // Programs and Sysvars
    pub token_program: Program<'info, Token>,
}
