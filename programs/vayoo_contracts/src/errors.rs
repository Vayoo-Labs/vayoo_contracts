use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("You are not authorized to perform this action.")]
    Unauthorized, // 0x1770
    #[msg("InvalidInstruction")]
    Invalid, // 0x1771
    #[msg("The config has already been initialized.")]
    ReInitialize, // 0x1772
    #[msg("The config has not been initialized.")]
    UnInitialize, // 0x1773
    #[msg("Argument is invalid.")]
    InvalidArgument, // 0x1774
    #[msg("An overflow occurs.")]
    Overflow, // 0x1775
    #[msg("Pyth has an internal error.")]
    PythError, // 0x1776
    #[msg("Pyth price oracle is offline.")]
    PythOffline, // 0x1777
    #[msg("Program should not try to serialize a price account.")]
    TryToSerializePriceAccount, // 0x1778
    #[msg("Contract has Ended Already")]
    ContractEnded, // 0x1779
    #[msg("Contract has been halted for trading and depositing")]
    ContractHalted, // 0x177a
    #[msg("Contract has been halted for depositing")]
    ContractDepositHalted, // 0x177b
    #[msg("Contract has been halted for trading")]
    ContractTradingHalted, // 0x177c
    #[msg("Trying to close a bigger position than what you have opened")]
    ClosePositionBiggerThanOpened, // 0x177d
    #[msg("Maturity Time not reached")]
    MaturityNotReached, // 0x177e
    #[msg("Already In Settle Mode")]
    AlreadySettling, // 0x177f
    #[msg("Leaves Vault Unhealthy short")]
    ShortLeaveUnhealthy, // 0x1780
    #[msg("Need to close short before opening long")]
    CloseShortBeforeLong, // 0x1781
    #[msg("Need to close short before opening long")]
    CloseLongBeforeShort, // 0x1782
    #[msg("Action leaves the platform unhealthy")]
    PlatformUnhealthy, // 0x1783
    #[msg("Contract not in settling mode")]
    NotSettling, // 0x1784
    #[msg("Contract is in settling mode")]
    IsSettling, // 0x1784
    #[msg("Error in internal accounting")]
    ErrorAccounting, // 0x1785
    #[msg("LeakInFreeAccountUser")]
    LeakInFAccount, // 0x1786
    #[msg("Invalid Feed Type")]
    InvalidFeedType, // 0x1787
    #[msg("Not a valid Switchboard account")]
    InvalidSwitchboardAccount, // 0x1788
    #[msg("Switchboard feed has not been updated in 5 minutes")]
    StaleFeed, // 0x1789
    #[msg("Switchboard feed exceeded provided confidence interval")]
    ConfidenceIntervalExceeded, // 0x178a,
    #[msg("Invalid Feed")]
    InvalidOraclefeed, // 0x178b
    #[msg("Cant be used in prod mode")]
    NoTestInProd, // 0x178b
}
