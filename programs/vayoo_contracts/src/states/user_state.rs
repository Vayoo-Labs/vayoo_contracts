use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct UserState {
    pub contract_account: Pubkey,
    pub bump: u8,
    pub authority: Pubkey,

    pub ishalted: bool,
    pub issettled: bool,

    pub contract_position_net: i64,
    pub usdc_collateral_locked_total: u64,

    pub usdc_collateral_locked_as_mm: u64,
    pub lcontract_minted_as_mm: u64,

    pub lcontract_bought_as_user: u64,
    pub scontract_sold_as_user: u64,
    pub usdc_collateral_locked_as_user: u64,
    pub usdc_collateral_spent_as_user: u64,

    pub usdc_deposited: u64,
    pub usdc_withdrawn: u64,
    pub usdc_free: u64,

    pub reserved: [u64; 15],
}
