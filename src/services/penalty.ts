import { doc, runTransaction } from "firebase/firestore";

import { db } from "../firebase";

export const applyNoShowPenalty = async (reservationId: string) => {
  const reservationRef = doc(db, "reservations", reservationId);

  await runTransaction(db, async (transaction) => {
    const reservationSnap = await transaction.get(reservationRef);

    if (!reservationSnap.exists()) {
      throw new Error("예약을 찾을 수 없습니다.");
    }

    const reservationData = reservationSnap.data();

    // 이미 노쇼 처리된 경우 중복 처리하지 않음
    if (reservationData.status === "noshow") {
      return;
    }

    /*
     * 평판과 노쇼 이력은 UserReputation 스마트 컨트랙트를
     * 기준 데이터로 사용한다.
     *
     * Firebase에서는 예약 상태만 관리한다.
     */
    transaction.update(reservationRef, {
      status: "noshow",
      verificationEnabled: false,
    });
  });
};