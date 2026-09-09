const parseNumberEnv = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseTimeSlots = (value: string | undefined) => {
  const fallback = ["10:00", "11:00", "13:00", "15:00", "17:00", "19:00"];

  return (value ? value.split(",") : fallback)
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseUnavailableTimeSlots = (value: string | undefined) => {
  return new Set(
    (value ? value.split(",") : ["11:00", "19:00"])
      .map((item) => item.trim())
      .filter(Boolean)
  );
};

export const appConfig = {
  defaultBaseDepositEth: parseNumberEnv(
    process.env.NEXT_PUBLIC_DEFAULT_BASE_DEPOSIT_ETH,
    0.01
  ),

  // 기존 SHOWUP 비교 기준용
  noShowExtraDepositEth: parseNumberEnv(
    process.env.NEXT_PUBLIC_NO_SHOW_EXTRA_DEPOSIT_ETH,
    0.005
  ),

  // 제안 평판 기반 보증금 모델의 beta 값
  reputationDepositBeta: parseNumberEnv(
    process.env.NEXT_PUBLIC_REPUTATION_DEPOSIT_BETA,
    1
  ),

  defaultStoreRating: parseNumberEnv(
    process.env.NEXT_PUBLIC_DEFAULT_STORE_RATING,
    4.5
  ),

  defaultStoreHoursText:
    process.env.NEXT_PUBLIC_DEFAULT_STORE_HOURS_TEXT || "운영 시간 정보 없음",

  timeSlots: parseTimeSlots(
    process.env.NEXT_PUBLIC_BOOKING_TIME_SLOTS
  ),

  unavailableTimeSlots: parseUnavailableTimeSlots(
    process.env.NEXT_PUBLIC_UNAVAILABLE_TIME_SLOTS
  ),
};