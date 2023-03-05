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
        let pnl= contract_state.starting_price.checked_sub(contract_state.ending_price).unwrap();
        let limited_pnl = min(pnl, limit_bound);

        //midrange=contract_limiting_bound_amplitude/2
        //payout_1_scontract=(starting_price+midrange) -ending_price
        //if payout_1_scontract>contract_limiting_bound_amplitude -> payout_1_lcontract=contract_limiting_bound_amplitude
        //if payout_1_scontract<0 -> payout_1_lcontract=0
        let gains_shorter=user_state.scontract_sold_as_user.checked_mul(limited_pnl).unwrap();
        let loss_shorter=user_state.scontract_sold_as_user.checked_mul(contract_state.limiting_amplitude.checked_sub(limited_pnl).unwrap()).unwrap();
        let cpi_accounts_transfer_from_locked = Transfer {
            from: ctx.accounts.vault_locked_collateral_ata.to_account_info(),
            to: ctx.accounts.vault_free_collateral_ata.to_account_info(),
            authority: ctx.accounts.user_state.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts_transfer_from_locked, user_state_signer_seeds);
        msg!("short: Transferring gainss : {}",gains_shorter);
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
        // We assume he sold all his lcontracts
        //if he didnt sell all his lcontracts, he'll excahnge his lcontracts vs the usdc value of the 
        //lcontracts (as described in the long setteling), funded from the shared escrow, but thats for another function
        //Again if we're in setteling and the mm is still with a position (he minted earlier and didnt burn before the end of the week)
        // then we just take all his locked collateral and send it to the shared escrow
        let amt_to_send_escrow=user_state.lcontract_minted_as_mm.checked_mul(contract_state.limiting_amplitude).unwrap();

        let cpi_accounts_transfer_to_escrow = Transfer {
            from: ctx.accounts.vault_locked_collateral_ata.to_account_info(),
            to: ctx.accounts.escrow_vault_collateral.to_account_info(),
            authority: ctx.accounts.user_state.to_account_info(),
        };

        let cpi_program_send_escrow = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program_send_escrow, cpi_accounts_transfer_to_escrow, user_state_signer_seeds);
        msg!("mm send escrow: {}", amt_to_send_escrow);
        token::transfer(cpi_ctx, amt_to_send_escrow)?;

        //Mint the underlying on the token account of the USER
        let cpi_accounts = Burn {
            mint: ctx.accounts.scontract_mint.to_account_info(),
            from: ctx.accounts.vault_locked_scontract_ata.to_account_info(),
            authority: ctx.accounts.user_state.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, user_state_signer_seeds);
        msg!("mm burn: {}", 10);
        token::burn(cpi_ctx, 10)?;

        //FYI initially the mm theorically has amount_of_stoken*contract_limiting_bound_amplitude$ in his usdc locked account
        //As collateral for his (technically) short and has 
        //amount_of_scontract_locked scontracts locked on the ata
        //0 lcontracts locked on the ata
 
        //amount_to_send_to_send_to_shared_escrow= amountof$inlocked
        //amount_to_send from locked to free =0
        //burn amount_of_scontract_locked lcontracts that is locked in the scontract_locked_ata
        
    }

    //Im writing what the function for the mm withdrawal after the settlement phase started will do : 
    //there is no user account involved here 
    //Its like a redemption process 

    //midrange=contract_limiting_bound_amplitude/2
    //payout_1_lcontract=ending_price-(starting_price-midrange)

    //User redeems red_lcontracts of lcontractrac
    //amount_to_send_to_the_user_wallet_account=payout_1_lcontract*red_lcontracts
    //from the shared escrow
    //and burn the lcontracts
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
        has_one = escrow_vault_collateral
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

    #[account(mut)]
    pub scontract_mint: Box<Account<'info, Mint>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    // Programs and Sysvars
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}