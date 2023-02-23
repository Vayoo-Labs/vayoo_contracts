//libraries
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint, Transfer, self};

//local imports
use crate::states::contract_state::ContractState;
use crate::states::user_state::UserState;

pub fn handle(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
    let user_state = &mut ctx.accounts.user_state;
    let contract_state = &mut ctx.accounts.contract_state;

    let cpi_accounts = Transfer {
        from: ctx.accounts.user_collateral_ata.to_account_info(),
        to: ctx.accounts.vault_collateral_ata.to_account_info(),
        authority: ctx.accounts.user_authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // Update State
    user_state.usdc_deposited += amount;
    contract_state.current_tvl_usdc += amount;

    Ok(())
}

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(mut)]
    pub user_authority: Signer<'info>,

    // TODO: Change this to ATA constraint checks
    #[account(mut, constraint = user_collateral_ata.mint==collateral_mint.key())]
    pub user_collateral_ata: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = vault_collateral_ata.mint==collateral_mint.key())]
    pub vault_collateral_ata: Box<Account<'info, TokenAccount>>,
    #[account[mut]]
    pub contract_state: Box<Account<'info, ContractState>>,
    #[account(mut, constraint = user_authority.key() == user_state.authority.key())]
    pub user_state: Box<Account<'info, UserState>>,
    pub collateral_mint: Box<Account<'info, Mint>>,

    // Programs and Sysvars
    pub token_program: Program<'info, Token>,
}
