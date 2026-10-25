import { CommentIcon } from "./product-card/product-card-icons";

export type SellerMetaSeller = {
  id?: string;
  name: string;
} | null | undefined;

/**
 * Seller and purchase-note section of the detail view. The card no
 * longer shows either, so the detail carries both in full: the seller
 * name untruncated (long unbreakable names wrap inside the row) and
 * the complete note text. A missing seller is an explicit state, not
 * a missing row, so the section keeps its shape.
 */
export function DetailSellerMeta({
  seller,
  note,
  onOpenSeller,
}: {
  seller: SellerMetaSeller;
  note?: string | null;
  onOpenSeller?: (sellerId: string) => void;
}) {
  const sellerName = seller?.name?.trim() ? seller.name : null;
  return (
    <section
      className="detail-seller-meta"
      aria-labelledby="detail-seller-meta-title"
      data-testid="detail-seller-meta"
    >
      <h3 id="detail-seller-meta-title">卖家与备注</h3>
      <p className="detail-seller-row">
        <span className="detail-meta-label">卖家</span>
        {sellerName ? (
          <span className="detail-seller-name">{sellerName}</span>
        ) : (
          <span className="detail-seller-unknown">卖家未知</span>
        )}
        {sellerName && seller?.id && onOpenSeller ? (
          <button
            type="button"
            onClick={() => {
              const targetSellerId = seller?.id;
              if (targetSellerId) onOpenSeller(targetSellerId);
            }}
            className="detail-seller-action"
          >
            查看同店商品 / 凑单 →
          </button>
        ) : null}
      </p>
      {note ? (
        <div className="detail-team-note">
          <CommentIcon />
          <div className="detail-team-note-body">
            <span className="detail-meta-label">采购备注</span>
            <p>{note}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
