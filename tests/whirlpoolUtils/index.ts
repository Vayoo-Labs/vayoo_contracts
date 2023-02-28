import * as anchor from "@project-serum/anchor";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import bs58 from 'bs58';
import { TickUtil, buildWhirlpoolClient, PriceMath, WhirlpoolContext, ORCA_WHIRLPOOL_PROGRAM_ID, increaseLiquidityQuoteByInputToken, PDAUtil } from "@orca-so/whirlpools-sdk";
import Decimal from "decimal.js";
import { createInOrderMints } from "./utils";
import { ORCA_WHIRLPOOL_CONFIG_ID } from "./utils/constants";
import { WhirlpoolClient } from "@orca-so/whirlpools-sdk";
import { Percentage } from "@orca-so/common-sdk";


export const createWhirlpool = async (whirlpoolCtx: WhirlpoolContext, wallet: anchor.Wallet) => {

    const connection = whirlpoolCtx.connection;
    const whirlpoolClient = buildWhirlpoolClient(whirlpoolCtx);
    const tickSpacing = 64; // Tick Spacing

    const initialTick = PriceMath.priceToInitializableTickIndex(new Decimal(100), 0, 0, tickSpacing)
    const [tokenAMintPubKey, tokenBMintPubKey] = await createInOrderMints(whirlpoolCtx);

    const { poolKey, tx } = await whirlpoolClient.createPool(
        ORCA_WHIRLPOOL_CONFIG_ID,
        tokenAMintPubKey,
        tokenBMintPubKey,
        tickSpacing,
        initialTick,
        wallet.publicKey
    );
    try {
        const txHash = await tx.addSigner(wallet.payer).buildAndExecute();
        await connection.confirmTransaction(txHash);
        return [tokenAMintPubKey, tokenBMintPubKey, poolKey];
    }
    catch (e) {
        console.log(e);
    }

}

export const addLiquidity = async (whirlpoolCtx: WhirlpoolContext, poolKey: PublicKey) => {

    // Load everything that you need
    const client = buildWhirlpoolClient(whirlpoolCtx);
    const pool = await client.getPool(poolKey);
    const poolData = pool.getData();
    const poolTokenAInfo = pool.getTokenAInfo();
    const poolTokenBInfo = pool.getTokenBInfo();

    // Derive the tick-indices based on a human-readable price
    const tokenADecimal = poolTokenAInfo.decimals;
    const tokenBDecimal = poolTokenBInfo.decimals;
    const tickLower = TickUtil.getInitializableTickIndex(
        PriceMath.priceToTickIndex(new Decimal(99), tokenADecimal, tokenBDecimal),
        poolData.tickSpacing
    );
    const tickUpper = TickUtil.getInitializableTickIndex(
        PriceMath.priceToTickIndex(new Decimal(101), tokenADecimal, tokenBDecimal),
        poolData.tickSpacing
    );
    console.log(tickLower, tickUpper)

    // Get a quote on the estimated liquidity and tokenIn (50 tokenA)
    const quote = increaseLiquidityQuoteByInputToken(
        poolTokenAInfo.mint,
        new Decimal(50000),
        tickLower,
        tickUpper,
        Percentage.fromFraction(1,100),
        pool
    );

    // Evaluate the quote if you need
    const { tokenMaxA, tokenMaxB } = quote

    // Construct the open position & increase_liquidity ix and execute the transaction.
    try {
        const { positionMint, tx } = await pool.openPosition(
            tickLower,
            tickUpper,
            quote
        );
        const txId = await tx.buildAndExecute();
        // Fetch the newly created position with liquidity
        const position = await client.getPosition(
            PDAUtil.getPosition(whirlpoolCtx.program.programId, positionMint).publicKey
        )
    } catch (e) {
        console.log(e);
    }

}