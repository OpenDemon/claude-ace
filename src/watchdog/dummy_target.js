export function calculateDiscount(price, discountPercent) {
  return price * (1 - discountPercent / 100);
}