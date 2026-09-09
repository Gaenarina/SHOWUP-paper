import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "./routerCompat";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Wallet, AlertCircle } from "lucide-react";
import { isAddress, parseEther } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { auth } from "@/firebase";
import { createReservation } from "@/services/reservationService";
import { getStoreById } from "@/services/storeService";
import { appConfig } from "@/config/appConfig";
import {
  NO_SHOW_DEPOSIT_ADDRESS,
  USER_REPUTATION_ADDRESS,
  noShowDepositAbi,
  userReputationAbi,
} from "@/services/web3/contracts";
import { WalletConnectButton } from "./WalletConnectButton";
import LoadingOverlay from "./LoadingOverlay";

function normalizeTimeValue(value: string) {
  const trimmed = String(value || "").trim();

  const amPmMatch = trimmed.match(/^(오전|오후)\s*(\d{1,2})(?::(\d{2}))?/);
  if (amPmMatch) {
    const period = amPmMatch[1];
    let hour = Number(amPmMatch[2]);
    const minute = amPmMatch[3] || "00";

    if (period === "오후" && hour < 12) hour += 12;
    if (period === "오전" && hour === 12) hour = 0;

    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  const hourTextMatch = trimmed.match(/^(\d{1,2})시(?:\s*(\d{1,2})분)?/);
  if (hourTextMatch) {
    const hour = hourTextMatch[1];
    const minute = hourTextMatch[2] || "00";

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
      2,
      "0"
    )}`;
  }

  if (/^\d{1,2}$/.test(trimmed)) {
    return `${trimmed.padStart(2, "0")}:00`;
  }

  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [hour, minute] = trimmed.split(":");
    return `${hour.padStart(2, "0")}:${minute}`;
  }

  return trimmed;
}

export function BookingConfirm() {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    storeId,
    sellerId,
    sellerWalletAddress: routeSellerWalletAddress = "",
    storeName,
    address,
    baseDeposit = appConfig.defaultBaseDepositEth,
    date,
    time,
    partySize = 1,
  } = location.state || {};

  const [userReputation, setUserReputation] = useState<number | null>(null);
  const [userNoShowCount, setUserNoShowCount] = useState<number | null>(null);

  const [sellerWalletAddress, setSellerWalletAddress] = useState(
    routeSellerWalletAddress
  );

  const [walletError, setWalletError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { address: walletAddress, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  /*
   * 제안 평판 기반 보증금 모델
   *
   * D = D_base * [1 + beta * (1 - R / 100)]
   *
   * R: 사용자 평판
   * beta: 평판 반영 계수
   */
  const effectiveReputation = userReputation ?? 100;

  const totalDeposit =
    baseDeposit *
    (1 +
      appConfig.reputationDepositBeta *
        (1 - effectiveReputation / 100));

  const penaltyDeposit = totalDeposit - baseDeposit;

  const walletConnected = isConnected && Boolean(walletAddress);

  useEffect(() => {
    const loadBookingContext = async () => {
      const store = storeId ? await getStoreById(storeId) : null;

      setSellerWalletAddress(
        routeSellerWalletAddress ||
          store?.sellerWalletAddress ||
          (store as any)?.walletAddress ||
          ""
      );

      if (
        !publicClient ||
        !USER_REPUTATION_ADDRESS ||
        !walletAddress ||
        !isAddress(walletAddress)
      ) {
        setUserReputation(null);
        setUserNoShowCount(null);
        return;
      }

      const reputationContractCode = await publicClient.getCode({
        address: USER_REPUTATION_ADDRESS,
      });

      if (!reputationContractCode) {
        setUserReputation(null);
        setUserNoShowCount(null);
        return;
      }

      const [, reputation, noShowCount, isRegistered] =
        await publicClient.readContract({
          address: USER_REPUTATION_ADDRESS,
          abi: userReputationAbi,
          functionName: "getUser",
          args: [walletAddress],
        });

      if (isRegistered) {
        setUserReputation(Number(reputation));
        setUserNoShowCount(Number(noShowCount));
      } else {
        // 신규 사용자는 초기 평판 100으로 계산
        setUserReputation(100);
        setUserNoShowCount(0);
      }
    };

    loadBookingContext().catch((error) => {
      console.warn(error);
      setUserReputation(null);
      setUserNoShowCount(null);
    });
  }, [
    publicClient,
    routeSellerWalletAddress,
    storeId,
    walletAddress,
  ]);

  if (!storeId || !sellerId || !storeName || !date || !time) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-500 mb-4">
            예약 정보가 없습니다.
          </p>

          <button
            onClick={() => navigate("/")}
            className="px-6 py-2 rounded-lg text-white"
            style={{ backgroundColor: "#566F2F" }}
          >
            홈으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  const reservationDate = new Date(date);

  const reservationDateText = format(
    reservationDate,
    "yyyy-MM-dd"
  );

  const normalizedTime = normalizeTimeValue(time);

  const reservationDateTime = new Date(
    `${reservationDateText}T${normalizedTime}:00`
  );

  const reservationTime = Math.floor(
    reservationDateTime.getTime() / 1000
  );

  const reservationDateStartTime = Math.floor(
    new Date(
      `${reservationDateText}T00:00:00`
    ).getTime() / 1000
  );

  const handleConfirmBooking = async () => {
    try {
      setWalletError("");

      const currentUser = auth.currentUser;

      if (!currentUser) {
        setWalletError(
          "예약을 확정하려면 먼저 로그인해주세요."
        );
        return;
      }

      if (!walletAddress) {
        setWalletError(
          "보증금 예치를 위해 MetaMask 지갑을 먼저 연결해주세요."
        );
        return;
      }

      if (!NO_SHOW_DEPOSIT_ADDRESS) {
        setWalletError(
          "NoShowDeposit 컨트랙트 주소가 설정되지 않았습니다."
        );
        return;
      }

      const normalizedSellerWalletAddress =
        sellerWalletAddress.trim();

      if (!isAddress(normalizedSellerWalletAddress)) {
        setWalletError(
          "판매자 지갑 주소가 없거나 올바르지 않습니다."
        );
        return;
      }

      if (!Number.isFinite(reservationTime)) {
        setWalletError(
          "예약 시간이 올바르지 않습니다."
        );
        return;
      }

      const now = Math.floor(Date.now() / 1000);

      if (reservationTime <= now) {
        setWalletError(
          "현재 시간보다 이후 시간만 예약할 수 있습니다."
        );
        return;
      }

      setIsSubmitting(true);

      const chainAppointmentId = BigInt(Date.now());

      const txHash = await writeContractAsync({
        address: NO_SHOW_DEPOSIT_ADDRESS,
        abi: noShowDepositAbi,
        functionName: "createAndPayDeposit",

        args: [
          chainAppointmentId,
          normalizedSellerWalletAddress,
          BigInt(reservationTime),
          BigInt(reservationDateStartTime),
        ],

        value: parseEther(
          totalDeposit.toFixed(18)
        ),

        gas: BigInt(1000000),
      });

      const reservationId =
        await createReservation({
          consumerId: currentUser.uid,
          sellerId,
          storeId,
          storeName,
          address: address || "주소 정보 없음",
          date: new Date(date),
          time,
          deposit: totalDeposit,
          partySize: Number(partySize) || 1,
          contractAddress:
            NO_SHOW_DEPOSIT_ADDRESS,
          txHash,
          chainAppointmentId:
            chainAppointmentId.toString(),
          consumerWalletAddress:
            walletAddress,
          sellerWalletAddress:
            normalizedSellerWalletAddress,
        });

      navigate("/booking/complete", {
        state: {
          reservationId,
          storeId,
          sellerId,
          storeName,
          address,
          date,
          time,
          partySize: Number(partySize) || 1,
          deposit: totalDeposit,
        },
      });
    } catch (error) {
      console.error(error);

      alert(
        "예약 생성 중 오류가 발생했습니다."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen p-4 pb-20">
      <LoadingOverlay
        isOpen={isSubmitting}
        message="보증금을 예치하고 예약을 확정하는 중입니다."
      />

      <div className="mb-6">
        <h2
          className="text-2xl font-bold mb-1"
          style={{ color: "#566F2F" }}
        >
          보증금 확인
        </h2>

        <p className="text-gray-600">
          예약 전 보증금을 확인해주세요
        </p>
      </div>

      <div className="bg-white rounded-lg p-4 shadow-sm mb-4">
        <h3 className="font-semibold mb-3">
          예약 정보
        </h3>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">
              업체명
            </span>

            <span className="font-medium">
              {storeName}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-600">
              주소
            </span>

            <span className="font-medium">
              {address || "주소 정보 없음"}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-600">
              날짜
            </span>

            <span className="font-medium">
              {format(
                new Date(date),
                "yyyy년 M월 d일(E)",
                { locale: ko }
              )}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-600">
              시간
            </span>

            <span className="font-medium">
              {time}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-600">
              예약 인원
            </span>

            <span className="font-medium">
              {Number(partySize) || 1}명
            </span>
          </div>
        </div>
      </div>

      <div
        className="rounded-lg p-4 mb-4"
        style={{
          backgroundColor: "#FEF3C7",
          border: "2px solid #D97706",
        }}
      >
        <h3
          className="font-semibold mb-3"
          style={{ color: "#92400E" }}
        >
          보증금 안내
        </h3>

        <div className="space-y-2 text-sm">
          <div
            className="flex justify-between"
            style={{ color: "#92400E" }}
          >
            <span>기본 보증금</span>

            <span className="font-semibold">
              {baseDeposit.toFixed(3)} ETH
            </span>
          </div>

          <div
            className="flex justify-between"
            style={{ color: "#92400E" }}
          >
            <span>현재 평판</span>

            <span className="font-semibold">
              {userReputation === null
                ? "컨트랙트 확인 필요"
                : `${userReputation}점`}
            </span>
          </div>

          <div
            className="flex justify-between"
            style={{ color: "#92400E" }}
          >
            <span>내 노쇼 기록</span>

            <span className="font-semibold">
              {userNoShowCount === null
                ? "컨트랙트 확인 필요"
                : `${userNoShowCount}회`}
            </span>
          </div>

          <div
            className="flex justify-between"
            style={{ color: "#92400E" }}
          >
            <span>평판 반영 추가 보증금</span>

            <span className="font-semibold">
              {penaltyDeposit.toFixed(3)} ETH
            </span>
          </div>

          <div className="border-t border-amber-300 pt-2 mt-2">
            <div className="flex justify-between text-base">
              <span
                className="font-bold"
                style={{ color: "#92400E" }}
              >
                최종 예치 보증금
              </span>

              <span
                className="font-bold text-lg"
                style={{ color: "#D97706" }}
              >
                {totalDeposit.toFixed(3)} ETH
              </span>
            </div>
          </div>
        </div>
      </div>

      {(userNoShowCount ?? 0) > 0 && (
        <div
          className="rounded-lg p-4 mb-4 flex items-start gap-3"
          style={{
            backgroundColor: "#FEE2E2",
            border: "1px solid #EF4444",
          }}
        >
          <AlertCircle
            size={20}
            style={{
              color: "#DC2626",
              marginTop: 2,
            }}
          />

          <div>
            <p
              className="font-semibold text-sm"
              style={{ color: "#991B1B" }}
            >
              노쇼 기록이 있습니다
            </p>

            <p
              className="text-xs mt-1"
              style={{ color: "#991B1B" }}
            >
              평판이 낮아지면 다음 예약의
              보증금이 증가하며, 정상 이행이
              누적되면 평판이 회복됩니다.
            </p>
          </div>
        </div>
      )}

      {!walletConnected ? (
        <WalletConnectButton
          className="w-full py-4 rounded-lg font-semibold text-lg shadow-md mb-4 flex items-center justify-center gap-2"
          style={{
            backgroundColor: "#566F2F",
            color: "white",
          }}
          iconSize={24}
        />
      ) : (
        <div
          className="bg-white rounded-lg p-4 shadow-sm mb-4 border-2"
          style={{
            borderColor: "#566F2F",
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Wallet
              size={20}
              style={{
                color: "#566F2F",
              }}
            />

            <span
              className="font-semibold"
              style={{
                color: "#566F2F",
              }}
            >
              지갑 연결됨
            </span>
          </div>

          <p className="text-sm text-gray-600">
            {walletAddress?.slice(0, 6)}...
            {walletAddress?.slice(-4)}
          </p>
        </div>
      )}

      {walletError && (
        <p className="text-sm text-red-500 mb-4">
          {walletError}
        </p>
      )}

      <button
        type="button"
        onClick={handleConfirmBooking}
        disabled={
          !walletConnected ||
          isSubmitting
        }
        className="w-full py-4 rounded-lg text-white font-semibold text-lg shadow-md transition-all"
        style={{
          backgroundColor:
            walletConnected && !isSubmitting
              ? "#566F2F"
              : "#D1D5DB",

          cursor:
            walletConnected && !isSubmitting
              ? "pointer"
              : "not-allowed",
        }}
      >
        {isSubmitting
          ? "예약 생성 중..."
          : "보증금 예치하고 예약 확정"}
      </button>
    </div>
  );
}