use std::cmp::min;

//libraries
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::states::UserState;
//local imports
use crate::errors::ErrorCode;
use crate::states::contract_state::ContractState;

pub fn handle(ctx: Context<UserSettleLong>) -> Result<()> {
    let user_state = &mut ctx.accounts.user_state;
    let contract_state = &ctx.accounts.contract_state;

    require!(contract_state.is_settling, ErrorCode::NotSettling);

    let user_signer_seeds: &[&[&[u8]]] = &[&[
        user_state.contract_account.as_ref(),
        user_state.authority.as_ref(),
        &[user_state.bump],
    ]];

    let contract_signer_seeds: &[&[&[u8]]] = &[&[
        ctx.accounts.contract_state.name.as_bytes(),
        ctx.accounts.contract_state.lcontract_mint.as_ref(),
        ctx.accounts.contract_state.authority.as_ref(),
        &[ctx.accounts.contract_state.bump],
    ]];

    //1.Settle the long side
    if user_state.lcontract_bought_as_user > 0 {
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
        //if payout_1_scontract>contract_limiting_bound_amplitude -> payout_1_lcontract=contract_limiting_bound_amplitude
        //if payout_1_scontract<0 -> payout_1_lcontract=0
        let gains_longer = user_state
            .lcontract_bought_as_user
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
        msg!("user settle send from escrow: {}", gains_longer);
        token::transfer(cpi_ctx, gains_longer)?;

        let cpi_accounts = Burn {
            mint: ctx.accounts.lcontract_mint.to_account_info(),
            from: ctx.accounts.vault_lcontract_ata.to_account_info(),
            authority: user_state.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, user_signer_seeds);
        msg!("user settle burn: {}", user_state.lcontract_bought_as_user);
        token::burn(cpi_ctx, user_state.lcontract_bought_as_user)?;

        let local_pyt_multiplier = contract_state.pyth_price_multiplier;
        let contract_state_m = &mut ctx.accounts.contract_state;
        //update user states
        contract_state_m.global_current_issued_lcontract = contract_state_m
            .global_current_issued_lcontract
            .checked_sub(user_state.lcontract_bought_as_user)
            .unwrap();
        contract_state_m.global_current_locked_usdc = contract_state_m
            .global_current_locked_usdc
            .checked_sub(gains_longer)
            .unwrap();
        user_state.usdc_free += gains_longer;
        user_state.lcontract_bought_as_user = 0;
        user_state.contract_position_net = 0;
        user_state.issettled = true;
        //Making sure the whole platform is well collateralized
        let global_final_issued_contract = contract_state_m.global_current_issued_lcontract;

        let global_needed_collateral = global_final_issued_contract
            .checked_mul(pnl_lcontract)
            .unwrap()
            .checked_div(local_pyt_multiplier)
            .unwrap();

        if global_needed_collateral > contract_state_m.global_current_locked_usdc {
            msg!("global_needed_collateral: {}", global_needed_collateral);
            msg!(
                "global_current_locked_usdc: {}",
                contract_state_m.global_current_locked_usdc
            );
            return err!(ErrorCode::PlatformUnhealthy);
        }

        ctx.accounts.vault_lcontract_ata.reload()?;
        let lcontract_bal_after = ctx.accounts.vault_lcontract_ata.amount;
        if user_state.lcontract_bought_as_user != lcontract_bal_after {
            return err!(ErrorCode::ErrorAccounting);
        }
    }
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
    #[account(mut)]
    pub lcontract_mint: Box<Account<'info, Mint>>,

    // Programs and Sysvars
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}
