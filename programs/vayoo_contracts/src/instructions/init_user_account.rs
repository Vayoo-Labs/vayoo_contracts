//libraries
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use std::mem::size_of;

//local imports
use crate::states::contract_state::ContractState;
use crate::states::user_state::UserState;

pub fn handle(ctx: Context<InitUser>, bump: u8) -> Result<()> {
    let user_state = &mut ctx.accounts.user_state;

    user_state.bump = bump;
    user_state.usdc_deposited = 0;
    user_state.usdc_withdrawn = 0;
    user_state.ishalted = false;
    user_state.issettled = false;
    user_state.authority = ctx.accounts.user_authority.key();
    user_state.contract_account = ctx.accounts.contract_state.key();
    user_state.usdc_free=0;
    Ok(())
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct InitUser<'info> {
    #[account(mut)]
    pub user_authority: Signer<'info>,
    #[account(init,
        seeds = [contract_state.key().as_ref(), user_authority.key().as_ref()],
        bump,
        payer = user_authority,
        space = 8 + size_of::<UserState>()
        )]
    pub user_state: Box<Account<'info, UserState>>,

    #[account[
        mut,
        seeds = [contract_state.name.as_ref(), contract_state.lcontract_mint.key().as_ref(), contract_state.authority.key().as_ref()],
        bump
      ]]
    pub contract_state: Box<Account<'info, ContractState>>,
    #[account(init,
        token::mint = collateral_mint,
        token::authority = user_state,
        seeds = [
          b"free",
          user_state.key().as_ref(),
          collateral_mint.key().as_ref(),
        ],
        bump,
        payer = user_authority
      )]
    pub vault_free_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(init,
        token::mint = collateral_mint,
        token::authority = user_state,
        seeds = [
        b"locked",
        user_state.key().as_ref(),
        collateral_mint.key().as_ref(),
      ],
        bump,
        payer = user_authority
      )]
    pub vault_locked_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(init,
        token::mint = scontract_mint,
        token::authority = user_state,
        seeds = [
        b"free",
        user_state.key().as_ref(),
        scontract_mint.key().as_ref(),
      ],
        bump,
        payer = user_authority
      )]
    pub vault_free_scontract_ata: Box<Account<'info, TokenAccount>>,

    #[account(init,
        token::mint = scontract_mint,
        token::authority = user_state,
        seeds = [
        b"locked",
        user_state.key().as_ref(),
        scontract_mint.key().as_ref(),
      ],
        bump,
        payer = user_authority
      )]
    pub vault_locked_scontract_ata: Box<Account<'info, TokenAccount>>,

    pub collateral_mint: Box<Account<'info, Mint>>,
    pub scontract_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
