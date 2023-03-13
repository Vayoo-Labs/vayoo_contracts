use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("You are not authorized to perform this action.")]
    Unauthorized,
    #[msg("InvalidInstruction")]
    Invalid,
    #[msg("The config has already been initialized.")]
    ReInitialize,
    #[msg("The config has not been initialized.")]
    UnInitialize,
    #[msg("Argument is invalid.")]
    InvalidArgument,
    #[msg("An overflow occurs.")]
    Overflow,
    #[msg("Pyth has an internal error.")]
    PythError,
    #[msg("Pyth price oracle is offline.")]
    PythOffline,
    #[msg("Program should not try to serialize a price account.")]
    TryToSerializePriceAccount,
    #[msg("Contract has Ended Already")]
    ContractEnded,
    #[msg("Contract has been halted for trading and depositing")]
    ContractHalted,
    #[msg("Contract has been halted for depositing")]
    ContractDepositHalted,
    #[msg("Contract has been halted for trading")]
    ContractTradingHalted,
    #[msg("Trying to close a bigger position than what you have opened")]
    ClosePositionBiggerThanOpened,
    #[msg("Maturity Time not reached")]
    MaturityNotReached,
    #[msg("Already Settled")]
    AlreadySettled,
    #[msg("Leaves Vault Unhealthy short")]
    ShortLeaveUnhealthy,
    #[msg("Need to close short before opening long")]
    CloseShortBeforeLong,
    #[msg("Need to close short before opening long")]
    CloseLongBeforeShort,
    #[msg("Action leaves the platform unhealthy")]
    PlatformUnhealthy,

    
}
