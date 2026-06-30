// @ts-check
// Single source of truth for the Korean Pro billing legal copy.
//
// The SAME strings must appear at three touchpoints — the pre-purchase
// checkout screen, the receipt/email, and the license guide — so a buyer sees
// one consistent cancellation/refund policy everywhere (a G005/closure-panel
// requirement). Reflects Korean e-commerce expectations: a 7-day withdrawal
// window with the digital-service limitation, and that Lemon Squeezy is the
// Merchant of Record that actually processes payment/refunds.

/** Conditional refund window (days) surfaced in the ko copy. */
export const PRO_REFUND_WINDOW_DAYS = 7;

/** Individual ko legal lines (stable keys for UI binding). */
export const PRO_LEGAL_COPY_KO = Object.freeze({
  cancelAnytime: '구독은 언제든 해지할 수 있으며, 해지하면 다음 결제부터 청구되지 않습니다.',
  refundWindow: `결제 후 ${PRO_REFUND_WINDOW_DAYS}일 이내에는 고객지원을 통해 환불을 요청할 수 있습니다.`,
  digitalLimit: '다만 디지털 서비스 특성상 Pro 기능을 상당히 사용한 경우, 전자상거래법상 청약철회가 제한될 수 있습니다.',
  merchantOfRecord: '결제·영수증·환불은 판매대행사(Merchant of Record)인 Lemon Squeezy가 처리합니다.',
  support: '환불·결제 문의는 고객지원으로, 구독 해지·결제수단 변경은 Lemon Squeezy 고객 포털에서 할 수 있습니다.',
});

/**
 * The exact ordered policy block, rendered IDENTICALLY at checkout, in the
 * receipt/email, and in the license guide. Bind this single value everywhere;
 * never hand-write the policy at a touchpoint.
 */
export const PRO_LEGAL_COPY_BLOCK_KO = [
  PRO_LEGAL_COPY_KO.cancelAnytime,
  PRO_LEGAL_COPY_KO.refundWindow,
  PRO_LEGAL_COPY_KO.digitalLimit,
  PRO_LEGAL_COPY_KO.merchantOfRecord,
  PRO_LEGAL_COPY_KO.support,
].join('\n');
