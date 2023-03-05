use std::cmp::min;

//libraries
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint,Token, TokenAccount, Burn, self, Transfer};

use crate::states::UserState;
//local imports
use crate::states::{contract_state::ContractState};
use crate::errors::ErrorCode;

pub fn handle(
    ctx: Context<AdminSettle>    
) -> Result<()> {
    let user_state = & ctx.accounts.user_state;
    let contract_state = & ctx.accounts.contract_state;
    
    let user_state_signer_seeds: &[&[&[u8]]] = &[&[
        ctx.accounts.user_state.contract_account.as_ref(),
        ctx.accounts.user_state.authority.as_ref(),
        &[ctx.accounts.user_state.bump],
    ]];

    if user_state.scontract_sold_as_user>0 { 
        // then the guy is net short


        //FYI initially the short theorically has amount_of_stoken*contract_limiting_bound_amplitude$ in his usdc locked account
        //As collateral for his short and has 
        //amount_of_scontract_locked scontracts locked on the ata
        //0 lcontracts locked on the ata
        //The setteling process for the short is DIFFERENT FROM THE LONG: 
        
        let limit_bound=contract_state.limiting_amplitude.checked_div(2).unwrap();
        //pnl_per_contract_short is initialized at upper bound, thats step 1
        let mut pnl_per_contract_short= contract_state.starting_price+limit_bound;
        //case where ending price above upper bound (and shorter pnl is 0)
        let real_ending_price=min(contract_state.ending_price,pnl_per_contract_short);
        //the real pnl : step 2
        pnl_per_contract_short=pnl_per_contract_short.checked_sub(real_ending_price).unwrap();
        let limited_pnl_per_contract_short = min(pnl_per_contract_short, contract_state.limiting_amplitude);

        //midrange=contract_limiting_bound_amplitude/2
        //payout_1_scontract=(starting_price+midrange) -ending_price
        //if payout_1_scontract>contract_limiting_bound_amplitude -> payout_1_lcontract=contract_limiting_bound_amplitude
        //if payout_1_scontract<0 -> payout_1_lcontract=0
        let gains_shorter=user_state.scontract_sold_as_user.checked_mul(limited_pnl_per_contract_short).unwrap();
        //loss_shorter inited at the amount of collateral locked
        let mut  loss_shorter=user_state.scontract_sold_as_user.checked_mul(contract_state.limiting_amplitude).unwrap();
        loss_shorter=loss_shorter.checked_sub(gains_shorter).unwrap();
        let cpi_accounts_transfer_from_locked = Transfer {
            from: ctx.accounts.vault_locked_collateral_ata.to_account_info(),
            to: ctx.accounts.vault_free_collateral_ata.to_account_info(),
            authority: ctx.accounts.user_state.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts_transfer_from_locked, user_state_signer_seeds);
        msg!("short: Transferring gains : {}",gains_shorter);
        token::transfer(cpi_ctx, gains_shorter)?;

        let cpi_accounts_transfer_to_escrow = Transfer {
            from: ctx.accounts.vault_locked_collateral_ata.to_account_info(),
            to: ctx.accounts.escrow_vault_collateral.to_account_info(),
            authority: ctx.accounts.user_state.to_account_info(),
        };

        let cpi_program_send_escrow = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program_send_escrow, cpi_accounts_transfer_to_escrow, user_state_signer_seeds);
        msg!("short: Transferring loss: {}", loss_shorter);
        token::transfer(cpi_ctx, loss_shorter)?;
    
        //Mint the underlying on the token account of the USER
        let cpi_accounts = Burn {
            mint: ctx.accounts.scontract_mint.to_account_info(),
            from: ctx.accounts.vault_locked_scontract_ata.to_account_info(),
            authority: ctx.accounts.user_state.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, user_state_signer_seeds);
        token::burn(cpi_ctx, user_state.scontract_sold_as_user)?;


        //amount_gains=amount_of_scontract_locked*payout_1_scontract
        //amount_to_send_to_send_to_shared_escrow= amountof$inlocked-amount_gains
        //amount_to_send from locked to free =amount_gains
        //burn amount_of_scontract_locked lcontracts that is locked in the scontract_locked_ata
        
    }


    if user_state.lcontract_minted_as_mm>0 { 
    //if false { 
        
        let limit_bound=contract_state.limiting_amplitude.checked_div(2).unwrap();
        //pnl_per_contract_short is initialized at upper bound, thats step 1
        let mut pnl_per_contract_short= contract_state.starting_price+limit_bound;
        //case where ending price above upper bound (and shorter pnl is 0)
        let real_ending_price=min(contract_state.ending_price,pnl_per_contract_short);
        //the real pnl : step 2
        pnl_per_contract_short=pnl_per_contract_short.checked_sub(real_ending_price).unwrap();
        let limited_pnl_per_contract_short = min(pnl_per_contract_short, contract_state.limiting_amplitude);

        //midrange=contract_limiting_bound_amplitude/2
        //payout_1_scontract=(starting_price+midrange) -ending_price
        //if payout_1_scontract>contract_limiting_bound_amplitude -> payout_1_lcontract=contract_limiting_bound_amplitude
        //if payout_1_scontract<0 -> payout_1_lcontract=0
        let gains_shorter=user_state.lcontract_minted_as_mm.checked_mul(limited_pnl_per_contract_short).unwrap();
        //loss_shorter inited at the amount of collateral locked
        let mut  loss_shorter=user_state.lcontract_minted_as_mm.checked_mul(contract_state.limiting_amplitude).unwrap();
        loss_shorter=loss_shorter.checked_sub(gains_shorter).unwrap();
        let cpi_accounts_transfer_from_locked = Transfer {
            from: ctx.accounts.vault_locked_collateral_ata.to_account_info(),
            to: ctx.accounts.vault_free_collateral_ata.to_account_info(),
            authority: ctx.accounts.user_state.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts_transfer_from_locked, user_state_signer_seeds);
        msg!("short: Transferring gains : {}",gains_shorter);
        token::transfer(cpi_ctx, gains_shorter)?;

        let cpi_accounts_transfer_to_escrow = Transfer {
            from: ctx.accounts.vault_locked_collateral_ata.to_account_info(),
            to: ctx.accounts.escrow_vault_collateral.to_account_info(),
            authority: ctx.accounts.user_state.to_account_info(),
        };

        let cpi_program_send_escrow = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program_send_escrow, cpi_accounts_transfer_to_escrow, user_state_signer_seeds);
        msg!("short: Transferring loss: {}", loss_shorter);
        token::transfer(cpi_ctx, loss_shorter)?;
    
        //Mint the underlying on the token account of the USER
        let cpi_accounts = Burn {
            mint: ctx.accounts.scontract_mint.to_account_info(),
            from: ctx.accounts.vault_locked_scontract_ata.to_account_info(),
            authority: ctx.accounts.user_state.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, user_state_signer_seeds);
        token::burn(cpi_ctx, user_state.lcontract_minted_as_mm)?;

    }

    Ok(())
}

#[derive(Accounts)]
pub struct AdminSettle<'info> {
    // Super User
    #[account(mut)]
    pub contract_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [contract_state.name.as_bytes(), contract_state.lcontract_mint.key().as_ref(), contract_authority.key().as_ref()],
        bump,
        //has_one = escrow_vault_collateral
    )]
    pub contract_state: Box<Account<'info, ContractState>>,
    #[account(
        mut,
        seeds = [contract_state.key().as_ref(), user_state.authority.key().as_ref()],
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
        token::mint = contract_state.collateral_mint,
        token::authority = user_state
    )]
    pub vault_locked_collateral_ata: Box<Account<'info, TokenAccount>>,
      
    #[account(
        mut,
        token::mint = contract_state.scontract_mint,
        token::authority = user_state
    )]
    pub vault_locked_scontract_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,

      )]
    pub escrow_vault_collateral: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub scontract_mint: Box<Account<'info, Mint>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    // Programs and Sysvars
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}