import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/firebase";
import type { Reservation } from "@/types/reservation";
import type { AppUser } from "@/types/user";
import { DEMO_STORE_IDS } from "@/services/storeService";

const VERIFICATION_LIMIT_MS = 20 * 60 * 1000;

type CreateReservationInput = {
  consumerId: string;
  sellerId: string;
  storeId: string;
  storeName: string;
  address: string;
  date: Date;
  time: string;
  deposit: number;
  partySize?: number;
  contractAddress?: string;
  txHash?: string;
  chainAppointmentId?: string;
  consumerWalletAddress?: string;
  sellerWalletAddress?: string;
};

const convertDate = (value: any) => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  return new Date(value);
};

const getReputationTitle = (noShowCount: number) => {
  if (noShowCount === 0) return "우수 고객";
  if (noShowCount <= 2) return "일반 고객";
  return "노쇼 주의";
};

const mapReservation = (id: string, data: any) => {
  return {
    id,
    ...data,
    date: convertDate(data.date) ?? new Date(),
    verificationEnabledAt: convertDate(data.verificationEnabledAt),
    verificationExpiresAt: convertDate(data.verificationExpiresAt),
  } as Reservation;
};

export const createReservation = async ({
  consumerId,
  sellerId,
  storeId,
  storeName,
  address,
  date,
  time,
  deposit,
  partySize = 1,
  contractAddress = "",
  txHash = "",
  chainAppointmentId = "",
  consumerWalletAddress = "",
  sellerWalletAddress = "",
}: CreateReservationInput) => {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("로그인이 필요합니다.");
  }

  if (consumerId !== currentUser.uid) {
    throw new Error(
      "로그인한 사용자와 예약자 정보가 일치하지 않습니다."
    );
  }

  const consumerSnap = await getDoc(
    doc(db, "users", currentUser.uid)
  );

  if (!consumerSnap.exists()) {
    throw new Error("고객 정보를 찾을 수 없습니다.");
  }

  const consumer = consumerSnap.data() as AppUser;
  const noShowCount = consumer.noShowCount ?? 0;

  const docRef = await addDoc(
    collection(db, "reservations"),
    {
      consumerId,
      sellerId,
      storeId,
      storeName,
      address,

      consumerName: consumer.name,
      sellerName: storeName,

      date,
      time,
      deposit,
      partySize: Number(partySize) || 1,

      status: "pending",

      consumerVerified: false,
      sellerVerified: false,

      verificationEnabled: false,
      verificationEnabledAt: null,
      verificationExpiresAt: null,

      /*
       * 화면 표시용 스냅샷.
       * 실제 평판 정책의 기준 데이터는
       * UserReputation 스마트 컨트랙트이다.
       */
      customerReputation: {
        title: getReputationTitle(noShowCount),
        noShowCount,
        attendanceRate: 100,
      },

      contractAddress,
      txHash,
      chainAppointmentId,

      consumerWalletAddress,
      sellerWalletAddress,

      createdAt: serverTimestamp(),
    }
  );

  return docRef.id;
};

export const subscribeReservation = (
  reservationId: string,
  callback: (reservation: Reservation | null) => void
) => {
  return onSnapshot(
    doc(db, "reservations", reservationId),
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      callback(
        mapReservation(
          snapshot.id,
          snapshot.data()
        )
      );
    }
  );
};

export const subscribeConsumerReservations = (
  consumerId: string,
  callback: (reservations: Reservation[]) => void
) => {
  const q = query(
    collection(db, "reservations"),
    where("consumerId", "==", consumerId)
  );

  return onSnapshot(q, (snapshot) => {
    const reservations = snapshot.docs.map((item) =>
      mapReservation(item.id, item.data())
    );

    callback(reservations);
  });
};

export const subscribeSellerReservations = (
  sellerId: string,
  callback: (reservations: Reservation[]) => void
) => {
  const q = query(
    collection(db, "reservations"),
    where("sellerId", "==", sellerId)
  );

  return onSnapshot(q, (snapshot) => {
    const reservations = snapshot.docs.map((item) =>
      mapReservation(item.id, item.data())
    );

    callback(reservations);
  });
};

export const subscribeDemoAdminReservations = (
  callback: (reservations: Reservation[]) => void
) => {
  const q = query(
    collection(db, "reservations"),
    where(
      "storeId",
      "in",
      DEMO_STORE_IDS
    )
  );

  return onSnapshot(q, (snapshot) => {
    const reservations = snapshot.docs
      .map((item) =>
        mapReservation(
          item.id,
          item.data()
        )
      )
      .sort((a, b) => {
        const dateDiff =
          a.date.getTime() -
          b.date.getTime();

        if (dateDiff !== 0) {
          return dateDiff;
        }

        return a.time.localeCompare(
          b.time
        );
      });

    callback(reservations);
  });
};

export const enableVerification = async (
  reservationId: string
) => {
  const now = new Date();

  const expiresAt = new Date(
    now.getTime() +
      VERIFICATION_LIMIT_MS
  );

  await updateDoc(
    doc(
      db,
      "reservations",
      reservationId
    ),
    {
      status: "confirmed",
      sellerVerified: true,
      verificationEnabled: true,

      verificationEnabledAt:
        Timestamp.fromDate(now),

      verificationExpiresAt:
        Timestamp.fromDate(
          expiresAt
        ),
    }
  );
};

export const verifyConsumer = async (
  reservationId: string
) => {
  const reservationRef = doc(
    db,
    "reservations",
    reservationId
  );

  const snapshot =
    await getDoc(reservationRef);

  if (!snapshot.exists()) {
    throw new Error(
      "예약 정보를 찾을 수 없습니다."
    );
  }

  const data = snapshot.data();

  const expiresAt = convertDate(
    data.verificationExpiresAt
  );

  if (
    !data.verificationEnabled ||
    !expiresAt
  ) {
    throw new Error(
      "아직 인증 버튼이 활성화되지 않았습니다."
    );
  }

  if (data.consumerVerified) {
    return;
  }

  if (
    Date.now() >
    expiresAt.getTime()
  ) {
    await expireReservationIfNeeded(
      reservationId
    );

    throw new Error(
      "인증 시간이 만료되었습니다."
    );
  }

  await updateDoc(
    reservationRef,
    {
      status: "completed",
      consumerVerified: true,
      verificationEnabled: false,
    }
  );
};

/*
 * 인증 시간 만료 처리
 *
 * 이 단계에서는 Firebase 예약을 바로 noshow로 바꾸지 않는다.
 * 판매자의 온체인 settleNoShow() 정산이 완료된 뒤에
 * markReservationAsNoShow()에서 최종 노쇼 상태로 변경한다.
 */
export const expireReservationIfNeeded = async (
  reservationId: string
) => {
  const reservationRef = doc(
    db,
    "reservations",
    reservationId
  );

  await runTransaction(
    db,
    async (transaction) => {
      const snapshot =
        await transaction.get(
          reservationRef
        );

      if (!snapshot.exists()) {
        return;
      }

      const data =
        snapshot.data();

      if (
        data.consumerVerified === true ||
        data.status === "completed" ||
        data.status === "noshow" ||
        data.status === "cancelled"
      ) {
        return;
      }

      const expiresAt =
        convertDate(
          data.verificationExpiresAt
        );

      if (
        !expiresAt ||
        Date.now() <=
          expiresAt.getTime()
      ) {
        return;
      }

      transaction.update(
        reservationRef,
        {
          // confirmed 상태는 유지
          verificationEnabled: false,

          verificationExpiresAt:
            Timestamp.fromDate(
              expiresAt
            ),
        }
      );
    }
  );
};

export const expireOverdueReservations = async (
  reservations: Reservation[]
) => {
  const targets =
    reservations.filter(
      (reservation) => {
        if (
          !reservation.verificationEnabled
        ) {
          return false;
        }

        if (
          reservation.consumerVerified
        ) {
          return false;
        }

        if (
          reservation.status !==
          "confirmed"
        ) {
          return false;
        }

        if (
          !reservation.verificationExpiresAt
        ) {
          return false;
        }

        return (
          Date.now() >
          reservation
            .verificationExpiresAt
            .getTime()
        );
      }
    );

  await Promise.all(
    targets.map(
      (reservation) =>
        expireReservationIfNeeded(
          reservation.id
        )
    )
  );
};

export const cancelReservation = async (
  reservationId: string
) => {
  await updateDoc(
    doc(
      db,
      "reservations",
      reservationId
    ),
    {
      status: "cancelled",
      verificationEnabled: false,
    }
  );
};

export const markReservationAsCancelled =
  async (
    reservationId: string
  ) => {
    await updateDoc(
      doc(
        db,
        "reservations",
        reservationId
      ),
      {
        status: "cancelled",
        verificationEnabled: false,
      }
    );
  };

/*
 * settleNoShow() 트랜잭션이 성공한 뒤 호출한다.
 * 이 시점에서 최종 노쇼 상태를 Firebase에 반영한다.
 */
export const markReservationAsNoShow =
  async (
    reservationId: string
  ) => {
    await updateDoc(
      doc(
        db,
        "reservations",
        reservationId
      ),
      {
        status: "noshow",
        verificationEnabled: false,
      }
    );
  };