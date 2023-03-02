import { DecimalUtil } from "@orca-so/common-sdk";
import { buildWhirlpoolClient, PDAUtil, SwapUtils, TickArrayUtil, WhirlpoolContext } from "@orca-so/whirlpools-sdk";
import * as anchor from "@project-serum/anchor";
import { Program, BN, web3 } from "@project-serum/anchor";
import { getAccount, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token-v2";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from "@solana/web3.js";
import { assert, expect } from "chai";
import { VayooContracts } from "../target/types/vayoo_contracts";
import { superUserKey, testUserKey } from "./testKeys";
import { sleep, toNativeAmount, toUiAmount } from "./utils";
import { GLOBAL_STATE_SEED, ONE_WEEK_IN_SECONDS, PYTH_FEED, USDC_DECIMALS } from "./utils/constants";
import { addLiquidity, createWhirlpool } from "./whirlpoolUtils";
import { ORCA_WHIRLPOOL_PROGRAM_ID } from "./whirlpoolUtils/utils/constants";
import { createAndMintToAssociatedTokenAccount, createMint } from "./whirlpoolUtils/utils/token";

const DEBUG_MODE = false; // If true, log useful info accross the tests on the console

describe("vayoo_contracts", () => {
  const provider = anchor.AnchorProvider.env();
  // anchor.setProvider(provider);
  const program = anchor.workspace.VayooContracts as Program<VayooContracts>;
  const connection = program.provider.connection;
  const whirlpoolCtx = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
  const whirlpoolClient = buildWhirlpoolClient(whirlpoolCtx);
  const superUser = superUserKey.keypair;
  const testUser = testUserKey.keypair;
  const testUserWallet = new anchor.Wallet(testUser);
  const pythFeed = new PublicKey(PYTH_FEED);
  let usdcMint: PublicKey;

  let accounts: any = {
    pythFeed,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
    tokenProgram: TOKEN_PROGRAM_ID
  }

  if (DEBUG_MODE) {
    console.log("Super User Key: ", superUser.publicKey.toString());
    console.log("Test User Key: ", testUser.publicKey.toString());
  }

  before("Setting up environment", async () => {
    const txHash = await connection.requestAirdrop(superUser.publicKey, LAMPORTS_PER_SOL * 10000);
    const txHash1 = await connection.requestAirdrop(testUser.publicKey, LAMPORTS_PER_SOL * 10000);
    await connection.confirmTransaction(txHash);
    await connection.confirmTransaction(txHash1);

    usdcMint = await createMint(provider);
    accounts.collateralMint = usdcMint

    if (DEBUG_MODE) console.log('Collateral Mint: ', usdcMint.toString());

    // mint usdc tokens to superUser and testUser
    await createAndMintToAssociatedTokenAccount(provider, accounts.collateralMint, toNativeAmount(1000000, USDC_DECIMALS), testUser.publicKey);
    await createAndMintToAssociatedTokenAccount(provider, accounts.collateralMint, toNativeAmount(1000000, USDC_DECIMALS), superUser.publicKey);
  })

  it("Create Global State", async () => {
    const [globalStateKey, globalStateKeyBump] = web3.PublicKey.findProgramAddressSync([Buffer.from(GLOBAL_STATE_SEED)], program.programId)
    accounts.globalState = globalStateKey

    await program.methods.createGlobalState(globalStateKeyBump).accounts({
      ...accounts,
      authority: superUser.publicKey
    }).signers([superUser]).rpc();

    const globalStateAccount = await program.account.globalState.fetch(globalStateKey);
    DEBUG_MODE ? console.log("Global State Key: ", globalStateKey.toString()) : null;
    assert.ok(globalStateAccount.totalTvlUsdc.toNumber() == 0);
  });

  it("Initialize Contract Account/State", async () => {
    const contractName = "v0";
    const timeNow = Math.floor(Date.now() / 1000)
    const contractEndTime = new BN(timeNow + ONE_WEEK_IN_SECONDS);
    const amplitude = new BN(30);

    const [scontractMint, scontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("scontract")],
        program.programId
      );
    const [lcontractMint, lcontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("lcontract")],
        program.programId
      );
    const [contractStateKey, contractStateKeyBump] = web3.PublicKey.findProgramAddressSync([Buffer.from(contractName), lcontractMint.toBuffer(), superUser.publicKey.toBuffer()], program.programId)
    accounts.contractState = contractStateKey;
    accounts.contractAuthority = superUser.publicKey;
    accounts.lcontractMint = lcontractMint;
    accounts.scontractMint = scontractMint;

    await program.methods.initializeContract(contractName, contractStateKeyBump, contractEndTime, amplitude).accounts({
      ...accounts
    }).signers([superUser]).rpc();

    const contractStateAccount = await program.account.contractState.fetch(contractStateKey);
    if (DEBUG_MODE) {
      console.log("L Contract Mint Key: ", lcontractMint.toString())
      console.log("S Contract Mint Key: ", scontractMint.toString())
      console.log("Contract State Key: ", contractStateKey.toString())
    }

    assert.ok(contractStateAccount.isHalted == false);
    assert.ok(contractStateAccount.pythFeedId.equals(pythFeed));
  });

  it("Initialize User State for test user", async () => {
    const [userStateKey, userStateKeyBump] = web3.PublicKey.findProgramAddressSync([accounts.contractState.toBuffer(), testUser.publicKey.toBuffer()], program.programId)
    const [vaultCollateralFreeAta, vaultCollateralFreeAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("free"), userStateKey.toBuffer(), accounts.collateralMint.toBuffer()], program.programId);
    const [vaultCollateralLockedAta, vaultCollateralLockedAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("locked"), userStateKey.toBuffer(), accounts.collateralMint.toBuffer()], program.programId);

    accounts.userState = userStateKey;
    accounts.userAuthority = testUser.publicKey;
    accounts.vaultFreeCollateralAta = vaultCollateralFreeAta;
    accounts.vaultLockedCollateralAta = vaultCollateralLockedAta;

    await program.methods.initializeUser(userStateKeyBump).accounts({
      ...accounts
    }).signers([testUser]).rpc();

    const userStateAccount = await program.account.userState.fetch(userStateKey);
    DEBUG_MODE ? console.log("User State Key: ", userStateKey.toString()) : null;
    assert.ok(userStateAccount.usdcDeposited.toNumber() == 0);
  });

  it("Create ATAs for test user", async () => {
    // Test PDAs
    await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, testUser.publicKey, true);
    await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.collateralMint, testUser.publicKey, true);
  });

  it("Deposit Collateral for test User", async () => {
    const userCollateralAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.collateralMint, testUser.publicKey, true);
    const amountToDeposit = new BN(toNativeAmount(10000, USDC_DECIMALS));
    accounts.userCollateralAta = userCollateralAtaBefore.address;

    await program.methods.depositCollateral(amountToDeposit).accounts({
      ...accounts
    }).signers([testUser]).rpc();
    const userUsdcAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.collateralMint, testUser.publicKey, true);

    const userStateAccount = await program.account.userState.fetch(accounts.userState);
    assert.ok(userStateAccount.usdcDeposited.eq(amountToDeposit));
    assert.ok(Number(userCollateralAtaBefore.amount - userUsdcAtaAfter.amount) == amountToDeposit.toNumber())
  });

  it("Mint lcontract as mm", async () => {
    const userlxAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, testUser.publicKey, true);

    const amountToMint = new BN(toNativeAmount(100, USDC_DECIMALS));
    accounts.mmLcontractTokenAta = userlxAtaBefore.address

    await program.methods.mintLContractMm(amountToMint).accounts({
      ...accounts
    }).signers([testUser]).rpc();

    const userStateAccount = await program.account.userState.fetch(accounts.userState);
    assert.ok(userStateAccount.lcontractMintedAsMm.eq(amountToMint));
  });

  it("Burn lcontract as mm", async () => {
    const userStateAccountBefore = await program.account.userState.fetch(accounts.userState);
    const amountToBurn = new BN(toNativeAmount(50, USDC_DECIMALS));

    await program.methods.burnLContractMm(amountToBurn).accounts({
      ...accounts
    }).signers([testUser]).rpc();

    const userStateAccountAfter = await program.account.userState.fetch(accounts.userState);
    assert.ok(userStateAccountAfter.lcontractMintedAsMm.sub(userStateAccountBefore.lcontractMintedAsMm).eq(amountToBurn));
  });

  it("Deploy whirlpool (lcontract / collateral ) + Add liquidity", async () => {
    const addLiquidityAmount = 1;
    const whirlpoolKey = await createWhirlpool(whirlpoolCtx, testUserWallet, accounts.lcontractMint, accounts.collateralMint, 50);
    accounts.whirlpoolKey = whirlpoolKey;
    const poolData = (await whirlpoolClient.getPool(whirlpoolKey)).getData();
    const position = await addLiquidity(whirlpoolCtx, whirlpoolKey, addLiquidityAmount);
    const positionData = position.getData();
    if (DEBUG_MODE) {
      console.log('Pool Mint A: ', poolData.tokenMintA.toString());
      console.log('Pool Mint B: ', poolData.tokenMintB.toString());
    }
    assert.ok(positionData.liquidity.toNumber() > 0);
  });

  it("Withdraw Collateral for test User", async () => {
    const userCollateralAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.collateralMint, testUser.publicKey, true);
    const amountToWithdraw = new BN(toNativeAmount(100, USDC_DECIMALS));

    await program.methods.withdrawCollateral(amountToWithdraw).accounts({
      ...accounts
    }).signers([testUser]).rpc();

    const userUsdcAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.collateralMint, testUser.publicKey, true);
    assert.ok(Number(userUsdcAtaAfter.amount - userCollateralAtaBefore.amount) == amountToWithdraw.toNumber())
  });

  it("Cannot create user state - Contract Ended", async () => {
    let msg = '';
    const contractName = "v1";
    const timeNow = Math.floor(Date.now() / 1000);
    const contractEndTime = new BN(timeNow + 3); // 3 seconds into the future
    const amplitude = new BN(30);

    const [scontractMint, scontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("scontract")],
        program.programId
      );
    const [lcontractMint, lcontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("lcontract")],
        program.programId
      );
    const [contractStateKey, contractStateKeyBump] = web3.PublicKey.findProgramAddressSync([Buffer.from(contractName), lcontractMint.toBuffer(), superUser.publicKey.toBuffer()], program.programId)

    // init contract with 3 second to the expiry
    await program.methods.initializeContract(contractName, contractStateKeyBump, contractEndTime, amplitude).accounts({
      ...accounts,
      contractState: contractStateKey,
      lcontractMint: lcontractMint,
      scontractMint: scontractMint
    }).signers([superUser]).rpc();

    // delay by 4 seconds
    await sleep(4);

    // try to create user state
    const [userStateKey, userStateKeyBump] = web3.PublicKey.findProgramAddressSync([contractStateKey.toBuffer(), testUser.publicKey.toBuffer()], program.programId)
    const [vaultCollateralFreeAta, vaultCollateralFreeAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("free"), userStateKey.toBuffer(), accounts.collateralMint.toBuffer()], program.programId);
    const [vaultCollateralLockedAta, vaultCollateralLockedAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("locked"), userStateKey.toBuffer(), accounts.collateralMint.toBuffer()], program.programId);

    await program.methods.initializeUser(userStateKeyBump).accounts({
      ...accounts,
      userState: userStateKey,
      contractState: contractStateKey,
      vaultFreeCollateralAta: vaultCollateralFreeAta,
      vaultLockedCollateralAta: vaultCollateralLockedAta,
    }).signers([testUser]).rpc().catch((e) => (msg = e.error.errorCode.code));
    assert.ok(msg == 'ContractEnded')
  });

  it("Cannot deposit - Contract Ended", async () => {
    let msg = '';
    const contractName = "v2";
    const timeNow = Math.floor(Date.now() / 1000);
    const contractEndTime = new BN(timeNow + 4); // 4 seconds into the future
    const amplitude = new BN(30);

    const [scontractMint, scontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("scontract")],
        program.programId
      );
    const [lcontractMint, lcontractMintBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from(contractName), Buffer.from("lcontract")],
        program.programId
      );
    const [contractStateKey, contractStateKeyBump] = web3.PublicKey.findProgramAddressSync([Buffer.from(contractName), lcontractMint.toBuffer(), superUser.publicKey.toBuffer()], program.programId)

    // init contract with 4 second to the expiry
    await program.methods.initializeContract(contractName, contractStateKeyBump, contractEndTime, amplitude).accounts({
      ...accounts,
      contractState: contractStateKey,
      lcontractMint,
      scontractMint
    }).signers([superUser]).rpc();

    // create user state
    const [userStateKey, userStateKeyBump] = web3.PublicKey.findProgramAddressSync([contractStateKey.toBuffer(), testUser.publicKey.toBuffer()], program.programId);
    const [vaultCollateralFreeAta, vaultCollateralFreeAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("free"), userStateKey.toBuffer(), accounts.collateralMint.toBuffer()], program.programId);
    const [vaultCollateralLockedAta, vaultCollateralLockedAtaBump] = web3.PublicKey.findProgramAddressSync([Buffer.from("locked"), userStateKey.toBuffer(), accounts.collateralMint.toBuffer()], program.programId);

    await program.methods.initializeUser(userStateKeyBump).accounts({
      ...accounts,
      userState: userStateKey,
      contractState: contractStateKey,
      vaultFreeCollateralAta: vaultCollateralFreeAta,
      vaultLockedCollateralAta: vaultCollateralLockedAta,
    }).signers([testUser]).rpc();

    // delay by 5 seconds
    await sleep(5);

    const amountToDeposit = new BN(toNativeAmount(0.02, USDC_DECIMALS));

    await program.methods.depositCollateral(amountToDeposit).accounts({
      ...accounts,
      userState: userStateKey,
      contractState: contractStateKey,
      vaultFreeCollateralAta: vaultCollateralFreeAta
    }).signers([testUser]).rpc().catch((e) => (msg = e.error.errorCode.code));
    assert.ok(msg == 'ContractEnded')
  });


  it("Long Contract - test User", async () => {
    // Getting all accounts for the swap
    const poolKey = accounts.whirlpoolKey;
    const poolData = (await whirlpoolClient.getPool(poolKey)).getData();
    const vaultLcontractAtaBefore = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, accounts.userState, true);
    const whirlpool_oracle_pubkey = PDAUtil.getOracle(whirlpoolCtx.program.programId, poolKey).publicKey;
    const a_input = DecimalUtil.toU64(DecimalUtil.fromNumber(1), 6);
    const amount = new anchor.BN(a_input);
    const other_amount_threshold = new anchor.BN(0);
    const amount_specified_is_input = true;
    const a_to_b = true;
    const sqrt_price_limit = SwapUtils.getDefaultSqrtPriceLimit(a_to_b);
    const tickArrays = TickArrayUtil.getTickArrayPDAs(poolData.tickCurrentIndex, poolData.tickSpacing, 3, whirlpoolCtx.program.programId, poolKey, a_to_b);

    await program.methods
      .longUser(
        amount,
        other_amount_threshold,
        sqrt_price_limit,
        amount_specified_is_input,
        a_to_b,
      )
      .accounts({
        ...accounts,
        whirlpoolProgram: whirlpoolCtx.program.programId,
        whirlpool: poolKey,
        tokenVaultA: poolData.tokenVaultA,
        tokenVaultB: poolData.tokenVaultB,
        tickArray0: tickArrays[0].publicKey,
        tickArray1: tickArrays[1].publicKey,
        tickArray2: tickArrays[2].publicKey,
        oracle: whirlpool_oracle_pubkey,
        vaultLcontractAta: vaultLcontractAtaBefore.address,
      })
      .rpc();
    const vaultLcontractAtaAfter = await getOrCreateAssociatedTokenAccount(connection, testUser, accounts.lcontractMint, accounts.userState, true);
    assert.ok((vaultLcontractAtaAfter.amount - vaultLcontractAtaBefore.amount) > 0)
  })
});
