import Wallet from "../models/wallet.model.js";
import Transaction from "../models/transaction.model.js";
import ApiError from "../../../shared/errors/api-error.js";
import { StatusCodes } from "http-status-codes";

const DAILY_BONUS_AMOUNT = 100;
const DAILY_BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Retrieves the user's wallet or initializes it with starter balance (500 coins).
 */
export const getOrCreateWallet = async (userId) => {
  let wallet = await Wallet.findOne({ userId });
  if (!wallet) {
    try {
      wallet = await Wallet.create({
        userId,
        balance: 500, // Starter bonus
      });
      // Record initial bonus transaction
      await Transaction.create({
        userId,
        type: "bonus",
        amount: 500,
        balanceAfter: 500,
        metadata: { reason: "Welcome starter gift coins" },
      });
    } catch (e) {
      if (e?.code === 11000) {
        wallet = await Wallet.findOne({ userId });
      } else {
        throw e;
      }
    }
  }

  // Calculate daily bonus availability
  const now = Date.now();
  const lastClaim = wallet.lastDailyBonusClaim
    ? new Date(wallet.lastDailyBonusClaim).getTime()
    : 0;
  const canClaimDailyBonus = now - lastClaim >= DAILY_BONUS_COOLDOWN_MS;
  const nextClaimAvailableAt = canClaimDailyBonus
    ? null
    : new Date(lastClaim + DAILY_BONUS_COOLDOWN_MS).toISOString();

  return {
    userId: String(wallet.userId),
    balance: wallet.balance,
    totalSpent: wallet.totalSpent,
    totalReceived: wallet.totalReceived,
    canClaimDailyBonus,
    nextClaimAvailableAt,
    lastDailyBonusClaim: wallet.lastDailyBonusClaim,
    updatedAt: wallet.updatedAt,
  };
};

/**
 * Claims free daily bonus coins (100 coins once per 24 hours).
 */
export const claimDailyBonus = async (userId) => {
  const wallet = await Wallet.findOne({ userId });
  if (!wallet) {
    await getOrCreateWallet(userId);
  }

  const now = Date.now();
  const lastClaim = wallet?.lastDailyBonusClaim
    ? new Date(wallet.lastDailyBonusClaim).getTime()
    : 0;

  if (now - lastClaim < DAILY_BONUS_COOLDOWN_MS) {
    const hoursLeft = Math.ceil(
      (DAILY_BONUS_COOLDOWN_MS - (now - lastClaim)) / (1000 * 60 * 60),
    );
    throw new ApiError(
      StatusCodes.TOO_MANY_REQUESTS,
      `Daily bonus already claimed. Please return in ${hoursLeft} hour(s).`,
    );
  }

  const updated = await Wallet.findOneAndUpdate(
    { userId },
    {
      $inc: { balance: DAILY_BONUS_AMOUNT },
      $set: { lastDailyBonusClaim: new Date() },
    },
    { new: true, upsert: true },
  );

  await Transaction.create({
    userId,
    type: "bonus",
    amount: DAILY_BONUS_AMOUNT,
    balanceAfter: updated.balance,
    metadata: { reason: "Daily login bonus" },
  });

  return {
    message: `Claimed +${DAILY_BONUS_AMOUNT} free coins!`,
    claimedAmount: DAILY_BONUS_AMOUNT,
    balance: updated.balance,
    nextClaimAvailableAt: new Date(Date.now() + DAILY_BONUS_COOLDOWN_MS).toISOString(),
  };
};

/**
 * Atomically deducts coins from a user's wallet with concurrency safety.
 */
export const deductCoins = async ({ userId, amount, session }) => {
  if (amount <= 0) return await getOrCreateWallet(userId);

  // Ensure wallet exists
  await getOrCreateWallet(userId);

  const query = {
    userId,
    balance: { $gte: amount },
  };

  const update = {
    $inc: {
      balance: -amount,
      totalSpent: amount,
    },
  };

  const options = { new: true };
  if (session) options.session = session;

  const updated = await Wallet.findOneAndUpdate(query, update, options);
  if (!updated) {
    const current = await Wallet.findOne({ userId });
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Insufficient coin balance. You need ${amount} coins, but your balance is ${current?.balance || 0} coins.`,
    );
  }

  return updated;
};

/**
 * Credits coins to a user's wallet (e.g. admin credit or receiving gifts).
 */
export const creditCoins = async ({
  userId,
  amount,
  type = "admin_credit",
  metadata = {},
  session,
}) => {
  if (amount <= 0) return await getOrCreateWallet(userId);

  await getOrCreateWallet(userId);

  const update = {
    $inc: {
      balance: amount,
      ...(type === "gift_received" ? { totalReceived: amount } : {}),
    },
  };

  const options = { new: true, upsert: true };
  if (session) options.session = session;

  const updated = await Wallet.findOneAndUpdate({ userId }, update, options);

  const txOptions = session ? [{ session }] : [];
  await Transaction.create(
    [
      {
        userId,
        type,
        amount,
        balanceAfter: updated.balance,
        metadata,
      },
    ],
    ...txOptions,
  );

  return updated;
};

/**
 * Retrieves paginated coin transactions history.
 */
export const getTransactionHistory = async (userId, query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = { userId };
  if (query.type) {
    filter.type = query.type;
  }

  const [items, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter),
  ]);

  return {
    items: items.map((t) => ({
      id: String(t._id),
      _id: String(t._id),
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      giftName: t.giftName,
      giftIcon: t.giftIcon,
      giftImage: t.giftImage,
      chatType: t.chatType,
      status: t.status,
      createdAt: t.createdAt,
      metadata: t.metadata,
    })),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  };
};
