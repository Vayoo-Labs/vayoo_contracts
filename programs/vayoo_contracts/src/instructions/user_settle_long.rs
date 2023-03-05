use std::cmp::min;

//libraries
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint,Token, TokenAccount, Burn, self, Transfer};

use crate::states::UserState;
//local imports
use crate::states::{contract_state::ContractState};
use crate::errors::ErrorCode;

pub fn handle(
    ctx: Context<UserSettleLong>    
) -> Result<()> {
    let user_state = & ctx.accounts.user_state;
    let contract_state = & ctx.accounts.contract_state;

    let contract_signer_seeds: &[&[&[u8]]] = &[&[
        ctx.accounts.contract_state.name.as_bytes(),
        ctx.accounts.contract_state.lcontract_mint.as_ref(),
        ctx.accounts.contract_state.authority.as_ref(),
        &[ctx.accounts.contract_state.bump],
    ]];

     //1.Settle the long side
     if user_state.lcontract_bought_as_user>0 { 
        //for this condition, we should also check the amounts of tokens in the token accounts to double check

        let midrange=contract_state.limiting_amplitude.checked_div(2).unwrap();
        let mut pnl_lcontract=contract_state.starting_price.checked_sub(midrange).unwrap();
        pnl_lcontract=contract_state.ending_price.checked_sub(pnl_lcontract).unwrap();
        //midrange=contract_limiting_bound_amplitude/2
        //payout_1_scontract=(starting_price+midrange) -ending_price
        if pnl_lcontract>contract_state.limiting_amplitude{
            pnl_lcontract=contract_state.limiting_amplitude;
        }

        if pnl_lcontract<0{
            pnl_lcontract=0;
        }

        //if payout_1_scontract>contract_limiting_bound_amplitude -> payout_1_lcontract=contract_limiting_bound_amplitude
        //if payout_1_scontract<0 -> payout_1_lcontract=0
        let gains_longer=user_state.lcontract_bought_as_user.checked_mul(pnl_lcontract).unwrap();

        let cpi_accounts_transfer_pnl_long = Transfer {
            from: ctx.accounts.escrow_vault_collateral.to_account_info(),
            to: ctx.accounts.vault_free_collateral_ata.to_account_info(),
            authority: ctx.accounts.contract_state.to_account_info(),
        };

        let cpi_program_redeem_pnl_long = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program_redeem_pnl_long, cpi_accounts_transfer_pnl_long, contract_signer_seeds);
        msg!("user settle send from escrow: {}", gains_longer);
        token::transfer(cpi_ctx, gains_longer)?;

        let cpi_accounts = Burn {
            mint: ctx.accounts.lcontract_mint.to_account_info(),
            from: ctx.accounts.vault_lcontract_ata.to_account_info(),
            authority: ctx.accounts.contract_state.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, contract_signer_seeds);
        msg!("user settle burn: {}", user_state.lcontract_bought_as_user);
        token::burn(cpi_ctx, user_state.lcontract_bought_as_user)?;
    }

    //and burn the lcontracts
    Ok(())
}

#[derive(Accounts)]
pub struct UserSettleLong<'info> {
    // Super User
    #[account(mut)]
    pub user_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [contract_state.name.as_bytes(), contract_state.lcontract_mint.key().as_ref(), contract_state.authority.key().as_ref()],
        bump,
        has_one = escrow_vault_collateral
    )]
    pub contract_state: Box<Account<'info, ContractState>>,
    #[account(
        mut,
        seeds = [contract_state.key().as_ref(), user_authority.key().as_ref()],
        bump,
        constraint = user_state.contract_account == contract_state.key() @ErrorCode::Invalid
    )]
    pub user_state: Box<Account<'info, UserState>>,
    #[account(
        mut, 
        token::mint = contract_state.collateral_mint,
        token::authority = user_state,
    )]
    pub vault_free_collateral_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut, 
        token::mint = contract_state.lcontract_mint,
        token::authority = user_state,
      )]
      pub vault_lcontract_ata: Box<Account<'info, TokenAccount>>,
      
    #[account(
        mut,
        seeds = [
            b"escrow",
            collateral_mint.key().as_ref(),
            contract_state.key().as_ref(),
            ],
            bump,
        token::mint = collateral_mint,
        token::authority = contract_state,
      )]
    pub escrow_vault_collateral: Box<Account<'info, TokenAccount>>,

    pub collateral_mint: Box<Account<'info, Mint>>,
    pub lcontract_mint: Box<Account<'info, Mint>>,

    // Programs and Sysvars
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}