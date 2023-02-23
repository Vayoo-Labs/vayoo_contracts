// libraries
use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct GlobalState {
    /// Bump/nonce for the global state pda
    pub bump: u8,
    pub authority: Pubkey,
    /// Is contract paused
    pub paused: bool,

    pub total_tvl_usdc: u64,

    /// extra space
    pub reserved: [u64; 15],
}
