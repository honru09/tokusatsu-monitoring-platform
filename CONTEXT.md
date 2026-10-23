# Domain glossary

## Franchise/IP category

The specific fictional property that a procurement listing can be assigned to
from explicit public listing evidence. `Kamen Rider`, `Ultraman`, `Super
Sentai`, and `Godzilla` are separate categories; generic terms such as
“monster” do not establish one. A listing with insufficient or conflicting
evidence remains unknown rather than being guessed.

## Toy category

The top-level merchandise family for in-scope procurement listings. Physical
toys belong to this family; books, magazines, cards, audio/video media, and
other flat collectibles remain outside the procurement scope even when they
mention an in-scope franchise.

## Seller

A public marketplace account or retailer name associated with one or more
listings. It is a sourcing entity, not a claim about the private identity of a
person behind the account.

## Seller segment

An operational purchasing group derived from public marketplace markers and
the catalogue currently visible to the system. A segment is explainable and
may change when the visible catalogue changes; it is not a personal profile or
a reliability score.

## Professional store

A seller explicitly marked as a store by the marketplace, or supplied by a
known retailer source.

## High-volume seller

A non-store seller with a large currently visible catalogue. The term describes
catalogue volume only and does not imply a legal or professional status.

## Specialist seller

A non-store seller whose currently visible catalogue is strongly concentrated
in one toy type.

## Active second-hand seller

A non-store seller with multiple currently visible listings that is neither
high-volume nor specialist.

## Occasional seller

A seller with only a small currently visible catalogue, or insufficient public
catalogue information for a more specific group.

## China market comparison

A resale-market price reference for a canonical product, backed by matched
public China-market offers. It is pricing evidence, not a procurement listing.
_Avoid_: China item, purchase candidate

## Japan procurement listing

A marketplace listing denominated in JPY that can be considered for purchase
after its product identity, availability, transaction type and costs are known.
_Avoid_: China comparison offer

## Reverse market search

A Japan-market search initiated by an unusually valuable China market
comparison for the same canonical product.
_Avoid_: automatic purchase, guaranteed arbitrage

## Inventory order (batch)

One purchase checkout mapped to one sellable inventory batch. Average cost is
`purchaseCost / initialQuantity` for the whole batch; v1 does not allocate cost
per SKU. Legacy `PurchaseBundle` / `PurchaseRecord` rows stay intact and may
dual-write into an `InventoryOrder` via `sourceBundleId`.
_Avoid_: SKU ledger, ERP cost allocation

## Cross-market opportunity

An evaluated pairing of one Japan procurement listing and one China market
comparison for the same canonical product. It is ready only when identity,
quantity, volume, exchange rate and all configured costs support the claimed
profit.
_Avoid_: price difference, AI opportunity

## Opportunity needing facts

A cross-market opportunity whose direction may be promising but whose profit
cannot yet be claimed because required evidence or costs are missing.
_Avoid_: profitable opportunity, rejected opportunity
