use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct UserState {
    pub contract_account: Pubkey, // 32
    pub bump: u8,                // 1
    pub authority: Pubkey,   // 32

    pub ishalted: bool,
    pub issettled: bool,

    pub underlying_position_net: i64,
    pub usdc_collateral_locked: u64,

    pub private_locked_collateral_usdc_addy: Pubkey,
    pub private_restroom_usdc_usdc: Pubkey,
    pub private_locked_short_underlying: Pubkey,
    pub private_locked_long_underlying: Pubkey,

    pub usdc_deposited: u64,
    pub usdc_withdrawn: u64,

    pub reserved: [u64; 15],
}
