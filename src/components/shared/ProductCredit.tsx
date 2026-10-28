import { PRODUCT_VERSION } from "../../modules/config/product.ts";

/** 博客和后台共用的静态署名；Astro 使用时无需客户端水合。 */
export default function ProductCredit() {
  return (
    <span className="product-credit">{`Powered by MadeMe · v${PRODUCT_VERSION}`}</span>
  );
}
