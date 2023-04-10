//libraries
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use std::mem::size_of;
use switchboard_v2::{AggregatorAccountData, SWITCHBOARD_PROGRAM_ID};

//local imports
use crate::errors::ErrorCode;
use crate::states::{contract_state::ContractState, PriceFeed};
use crate::types::FeedType;

pub fn handle(
    ctx: Context<InitializeContract>,
    contract_name: String,
    bump: u8,
    ending_time: u64,
    limiting_amplitude: u64,
    feed_type: u8,
) -> Result<()> {
    msg!("INITIALIZING WEEKLY CONTRACT");

    require!(
        feed_type < FeedType::Unknown as u8,
        ErrorCode::InvalidFeedType
    );

    let contract_state = &mut ctx.accounts.contract_state;
    let current_timestamp = Clock::get()?.unix_timestamp;

    // Contract Initialization
    contract_state.name = contract_name;
    contract_state.authority = ctx.accounts.contract_authority.key();
    contract_state.bump = bump;
    contract_state.escrow_vault_collateral = ctx.accounts.escrow_vault_collateral.key();
    contract_state.is_halted = false;
    contract_state.is_halted_deposit = false;
    contract_state.is_halted_trading = false;
    contract_state.is_settling = false;
    contract_state.collateral_mint = ctx.accounts.collateral_mint.key();
    contract_state.lcontract_mint = ctx.accounts.lcontract_mint.key();
    contract_state.scontract_mint = ctx.accounts.scontract_mint.key();
    contract_state.oracle_feed_type = feed_type;

    if feed_type == FeedType::Pyth as u8 {
        // PYTH
        let pyth_feed_price = ctx
            .accounts
            .pyth_feed
            .get_price_no_older_than(current_timestamp, 60)
            .ok_or(ErrorCode::PythOffline)?;

        let mut multiplicator = (-pyth_feed_price.expo) as u32;
        let base = 10 as u32;
        multiplicator = base.pow(multiplicator);

        msg!("Pyth, Initializing at {}", pyth_feed_price.price);

        contract_state.oracle_feed_key = ctx.accounts.pyth_feed.key();
        contract_state.oracle_price_multiplier = multiplicator as u64;
        contract_state.starting_price = pyth_feed_price.price as u64;
    } else if feed_type == FeedType::Switchboard as u8 {
        // SWITCH_BOARD
        // check feed owner
        let owner = *ctx.accounts.switchboard_feed.to_account_info().owner;
        if owner != SWITCHBOARD_PROGRAM_ID {
            return Err(error!(ErrorCode::InvalidSwitchboardAccount));
        }
        let switchboard_feed = &ctx.accounts.switchboard_feed.load()?;
        let switchboard_result = switchboard_feed.get_result()?;
        let expo = switchboard_result.scale;
        let price = switchboard_result.mantissa;
        

        // check whether the feed has been updated in the last 60 seconds
        switchboard_feed
            .check_staleness(Clock::get().unwrap().unix_timestamp, 60)
            .map_err(|_| error!(ErrorCode::StaleFeed))?;

        let mut multiplicator_swithchboard = (expo) as u32;
        let base = 10 as u32;
        multiplicator_swithchboard = base.pow(multiplicator_swithchboard);
        
        let mut multiplicator_vayoo = 6 as u32;
        let base = 10 as u32;
        multiplicator_vayoo = base.pow(multiplicator_vayoo);
        let mut real_price=(price) as u64;
        real_price=real_price.checked_mul(multiplicator_vayoo as u64).unwrap().checked_div(multiplicator_swithchboard as u64).unwrap();
        msg!("Switchboard, Initializing at {}", real_price);

        contract_state.oracle_feed_key = ctx.accounts.switchboard_feed.key();
        contract_state.oracle_price_multiplier = multiplicator_vayoo as u64;
        contract_state.starting_price = real_price as u64;
    }

    contract_state.limiting_amplitude = limiting_amplitude;
    contract_state.starting_time = current_timestamp as u64;
    contract_state.ending_price = 0;
    contract_state.ending_time = ending_time;
    contract_state.cap_product = 0;
    contract_state.current_tvl_usdc = 0;
    contract_state.current_tvl_underlying = 0;
    contract_state.global_current_locked_usdc = 0;
    contract_state.global_current_issued_lcontract = 0;

    Ok(())
}

#[derive(Accounts)]
#[instruction(contract_name: String, bumps: u8)]
pub struct InitializeContract<'info> {
    // Super User
    #[account(mut)]
    pub contract_authority: Signer<'info>,

    #[account(init,
        seeds = [contract_name.as_bytes(),lcontract_mint.key().as_ref(), contract_authority.key().as_ref()],
        bump,
        payer = contract_authority,
        space = 8 + size_of::<ContractState>()
    )]
    pub contract_state: Box<Account<'info, ContractState>>,

    #[account(init,
        mint::decimals = 6,
        mint::authority = contract_state,
        seeds = [contract_name.as_bytes(), b"lcontract"],
        bump,
        payer = contract_authority
    )]
    pub lcontract_mint: Box<Account<'info, Mint>>,

    #[account(init,
        mint::decimals = 6,
        mint::authority = contract_state,
        seeds = [contract_name.as_bytes(), b"scontract"],
        bump,
        payer = contract_authority
    )]
    pub scontract_mint: Box<Account<'info, Mint>>,

    #[account(init,
        token::mint = collateral_mint,
        token::authority = contract_state,
        seeds = [
        b"escrow",
        collateral_mint.key().as_ref(),
        contract_state.key().as_ref(),
      ],
        bump,
        payer = contract_authority
      )]
    pub escrow_vault_collateral: Box<Account<'info, TokenAccount>>,

    pub collateral_mint: Box<Account<'info, Mint>>,

    pub switchboard_feed: AccountLoader<'info, AggregatorAccountData>,
    pub pyth_feed: Account<'info, PriceFeed>,

    // Programs and Sysvars
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}
