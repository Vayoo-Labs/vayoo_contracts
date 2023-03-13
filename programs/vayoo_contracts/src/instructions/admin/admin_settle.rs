use std::cmp::min;

//libraries
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::states::UserState;
//local imports
use crate::errors::ErrorCode;
use crate::states::contract_state::ContractState;

pub fn handle(ctx: Context<AdminSettle>) -> Result<()> {
    let user_state = &mut ctx.accounts.user_state;
    let contract_state = &ctx.accounts.contract_state;

    let user_state_signer_seeds: &[&[&[u8]]] = &[&[
        user_state.contract_account.as_ref(),
        user_state.authority.as_ref(),
        &[user_state.bump],
    ]];
    let amplitude=ctx.accounts.contract_state.limiting_amplitude;
    let local_pyt_multiplier=contract_state.pyth_price_multiplier;

    let adapted_contract_limiting_amplitude=contract_state.limiting_amplitude.checked_mul(contract_state.pyth_price_multiplier)
    .unwrap();

    let midrange = contract_state
        .limiting_amplitude
        .checked_mul(contract_state.pyth_price_multiplier)
        .unwrap()
        .checked_div(2)
        .unwrap();

    let lower_bound=contract_state.starting_price.checked_sub(midrange).unwrap();
    let upper_bound=contract_state.starting_price+midrange;
    let mut final_price=contract_state.ending_price;
    if final_price>upper_bound{
        final_price=upper_bound;
    }
    if final_price<lower_bound{
        final_price=lower_bound;
    }
    
    let mut pnl_lcontract_long = final_price.checked_sub(lower_bound).unwrap();
    pnl_lcontract_long = min(pnl_lcontract_long, adapted_contract_limiting_amplitude);

    let mut gains_shorter_mm=0;
    let mut gains_shorter_user=0;
    if user_state.scontract_sold_as_user > 0 {
        // then the guy is net short

        //FYI initially the short theorically has amount_of_stoken*contract_limiting_bound_amplitude$ in his usdc locked account
        //As collateral for his short and has
        //amount_of_scontract_locked scontracts locked on the ata
        //0 lcontracts locked on the ata
        //The setteling process for the short is DIFFERENT FROM THE LONG:


        let mut limited_pnl_per_contract_short=upper_bound.checked_sub(final_price).unwrap();
        limited_pnl_per_contract_short = min(limited_pnl_per_contract_short, adapted_contract_limiting_amplitude);
        msg!(&format!("pnl_scontract  {}", limited_pnl_per_contract_short));

        let gains_shorter = user_state
            .scontract_sold_as_user
            .checked_mul(limited_pnl_per_contract_short)
            .unwrap()
            .checked_div(contract_state.pyth_price_multiplier)
            .unwrap();

        //loss_shorter inited at the amount of collateral locked
        let mut loss_shorter = user_state
            .scontract_sold_as_user
            .checked_mul(contract_state.limiting_amplitude)
            .unwrap();
        loss_shorter = loss_shorter.checked_sub(gains_shorter).unwrap();
        let cpi_accounts_transfer_from_locked = Transfer {
            from: ctx.accounts.vault_locked_collateral_ata.to_account_info(),
            to: ctx.accounts.vault_free_collateral_ata.to_account_info(),
            authority: user_state.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(
            cpi_program,
            cpi_accounts_transfer_from_locked,
            user_state_signer_seeds,
        );
        msg!("short: Transferring gains : {}", gains_shorter);
        token::transfer(cpi_ctx, gains_shorter)?;

        let cpi_accounts_transfer_to_escrow = Transfer {
            from: ctx.accounts.vault_locked_collateral_ata.to_account_info(),
            to: ctx.accounts.escrow_vault_collateral.to_account_info(),
            authority: user_state.to_account_info(),
        };

        let cpi_program_send_escrow = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(
            cpi_program_send_escrow,
            cpi_accounts_transfer_to_escrow,
            user_state_signer_seeds,
        );
        msg!("short: Transferring loss: {}", loss_shorter);
        token::transfer(cpi_ctx, loss_shorter)?;

        //Mint the underlying on the token account of the USER
        let cpi_accounts = Burn {
            mint: ctx.accounts.scontract_mint.to_account_info(),
            from: ctx.accounts.vault_locked_scontract_ata.to_account_info(),
            authority: user_state.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx =
            CpiContext::new_with_signer(cpi_program, cpi_accounts, user_state_signer_seeds);
        msg!("test: {}", user_state.scontract_sold_as_user);
        token::burn(cpi_ctx, user_state.scontract_sold_as_user)?;

        gains_shorter_user=gains_shorter;
    }

    if user_state.lcontract_minted_as_mm > 0 {
        //if false {


        let mut limited_pnl_per_contract_short=upper_bound.checked_sub(final_price).unwrap();
        limited_pnl_per_contract_short = min(limited_pnl_per_contract_short, adapted_contract_limiting_amplitude);

        let gains_shorter = user_state
            .lcontract_minted_as_mm
            .checked_mul(limited_pnl_per_contract_short)
            .unwrap()
            .checked_div(contract_state.pyth_price_multiplier)
            .unwrap();
        //loss_shorter inited at the amount of collateral locked
        let mut loss_shorter = user_state
            .lcontract_minted_as_mm
            .checked_mul(contract_state.limiting_amplitude)
            .unwrap();
        loss_shorter = loss_shorter.checked_sub(gains_shorter).unwrap();
        let cpi_accounts_transfer_from_locked = Transfer {
            from: ctx.accounts.vault_locked_collateral_ata.to_account_info(),
            to: ctx.accounts.vault_free_collateral_ata.to_account_info(),
            authority: user_state.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(
            cpi_program,
            cpi_accounts_transfer_from_locked,
            user_state_signer_seeds,
        );
        msg!("short: Transferring gains : {}", gains_shorter);
        token::transfer(cpi_ctx, gains_shorter)?;

        let cpi_accounts_transfer_to_escrow = Transfer {
            from: ctx.accounts.vault_locked_collateral_ata.to_account_info(),
            to: ctx.accounts.escrow_vault_collateral.to_account_info(),
            authority: user_state.to_account_info(),
        };

        let cpi_program_send_escrow = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(
            cpi_program_send_escrow,
            cpi_accounts_transfer_to_escrow,
            user_state_signer_seeds,
        );
        msg!("short: Transferring loss: {}", loss_shorter);
        token::transfer(cpi_ctx, loss_shorter)?;

        ctx.accounts.vault_locked_scontract_ata.reload()?;
        msg!(
            "S Balance: {}",
            ctx.accounts.vault_locked_scontract_ata.amount
        );
        //Mint the underlying on the token account of the USER
        let cpi_accounts = Burn {
            mint: ctx.accounts.scontract_mint.to_account_info(),
            from: ctx.accounts.vault_locked_scontract_ata.to_account_info(),
            authority: user_state.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx =
            CpiContext::new_with_signer(cpi_program, cpi_accounts, user_state_signer_seeds);
        msg!("test : {}", user_state.lcontract_minted_as_mm);
        token::burn(cpi_ctx, user_state.lcontract_minted_as_mm)?;


        gains_shorter_mm=gains_shorter;
    }

    let contract_state_m = &mut ctx.accounts.contract_state;
    if user_state.scontract_sold_as_user > 0 {

        //Please note below line should not be uncommented 
        //contract_state_m.global_current_issued_lcontract=contract_state_m.global_current_issued_lcontract.checked_sub(user_state.lcontract_minted_as_mm).unwrap();
        contract_state_m.global_current_locked_usdc=contract_state_m.global_current_locked_usdc.checked_sub(gains_shorter_user).unwrap();

        user_state.contract_position_net = user_state.contract_position_net+(user_state.scontract_sold_as_user as i64) ;
        user_state.scontract_sold_as_user=0;
        user_state.usdc_collateral_locked_as_user = 0;
        user_state.usdc_free=user_state.usdc_free+gains_shorter_user;
    }

    if user_state.lcontract_minted_as_mm > 0 {

        //Please note below line should not be uncommented 
        //contract_state_m.global_current_issued_lcontract=contract_state_m.global_current_issued_lcontract.checked_sub(user_state.lcontract_minted_as_mm).unwrap();
        contract_state_m.global_current_locked_usdc=contract_state_m.global_current_locked_usdc.checked_sub(gains_shorter_mm).unwrap();

        user_state.contract_position_net = user_state.contract_position_net+(user_state.lcontract_minted_as_mm as i64) ;
        user_state.lcontract_minted_as_mm=0;
        user_state.usdc_collateral_locked_as_mm = 0;
        user_state.usdc_free=user_state.usdc_free+gains_shorter_mm;
       
    }

    //Making sure the user vault is well collateralized
    let vault_final_scontract = ctx.accounts.vault_locked_scontract_ata.to_account_info();
    let vault_final_locked_usdc = ctx.accounts.vault_locked_collateral_ata.to_account_info();
    let vault_final_scontract_value = token::accessor::amount(&vault_final_scontract)?;
    let vault_final_locked_usdc_value = token::accessor::amount(&vault_final_locked_usdc)?;
    let needed_collateral = vault_final_scontract_value
        .checked_mul(amplitude)
        .unwrap();
    if needed_collateral > vault_final_locked_usdc_value {
        return err!(ErrorCode::ShortLeaveUnhealthy);
    }

    //update user states
    user_state.lcontract_minted_as_mm = 0;
    user_state.scontract_sold_as_user = 0;
    



        //Making sure the whole platform is well collateralized
        let global_final_issued_contract = contract_state_m.global_current_issued_lcontract;
        let global_needed_collateral = global_final_issued_contract
        .checked_mul(pnl_lcontract_long)
        .unwrap()
        .checked_div(local_pyt_multiplier)
        .unwrap();

        if global_needed_collateral > contract_state_m.global_current_locked_usdc {
            return err!(ErrorCode::PlatformUnhealthy);
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

    #[account(mut)]
    pub escrow_vault_collateral: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub scontract_mint: Box<Account<'info, Mint>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    // Programs and Sysvars
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}
