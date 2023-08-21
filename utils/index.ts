/**
 * inputNumber * 10 ** NUM_DECIMALS
 * @param inputNumber - number
 * @param numDecimals - number < 100
 * @returns
 */
export const toNativeAmount = (inputNumber: number, numDecimals: number) => {
    if (numDecimals >= 100) throw new Error("Must be < 100 decimal places");
    return inputNumber * 10 ** numDecimals;
};

export const toUiAmount = (inputNumber: number, numDecimals: number) => {
    if (numDecimals >= 100) throw new Error("Must be < 100 decimal places");
    return inputNumber / (10 ** numDecimals);
};

/**
 *
 * @param seconds
 */
export const sleep = (seconds: number) => new Promise((res) => setTimeout(res, seconds * 1e3));