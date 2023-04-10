use anchor_lang::prelude::*;

#[derive(Default, AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
pub enum FeedType {
    #[default]
    Pyth = 0,
    Switchboard = 1,
    Unknown = 2,
}
