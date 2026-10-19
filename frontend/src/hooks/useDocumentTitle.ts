import { useEffect } from 'react';

/** The product name, as the masthead shows it; the browser tab ends with it. */
export const PRODUCT_NAME = 'Cloud Provider Admin Console';

/** Names the browser tab after the page: "Models · Cloud Provider Admin Console". */
export const useDocumentTitle = (page?: string) => {
  useEffect(() => {
    document.title = page ? `${page} · ${PRODUCT_NAME}` : PRODUCT_NAME;
  }, [page]);
};
