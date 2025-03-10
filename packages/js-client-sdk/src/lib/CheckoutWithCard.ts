import type {
  ICustomizationOptions,
  Locale,
} from "@paperxyz/sdk-common-utilities";
import { DEFAULT_BRAND_OPTIONS } from "@paperxyz/sdk-common-utilities";
import {
  CHECKOUT_WITH_CARD_IFRAME_URL,
  PAPER_APP_URL,
} from "../constants/settings";
import type {
  ICheckoutWithCardConfigs,
  KycModal,
  ReviewResult,
} from "../interfaces/CheckoutWithCard";
import type {
  PaperSDKError,
  PaperSDKErrorCode,
} from "../interfaces/PaperSDKError";
import type { PriceSummary } from "../interfaces/PriceSummary";
import { LinksManager } from "../utils/LinksManager";
import { openCenteredPopup } from "../utils/device";
import { postMessageToIframe } from "../utils/postMessageToIframe";
import type { PaperPaymentElementConstructorArgs } from "./CreatePaymentElement";
import { PaperPaymentElement } from "./CreatePaymentElement";
import { Modal } from "./Modal";

export interface CheckoutWithCardLinkArgs {
  sdkClientSecret?: string;
  appName?: string;
  options?: ICustomizationOptions;
  locale?: Locale;
  configs?: ICheckoutWithCardConfigs;

  /**
   * @deprecated: No longer used. Domain is set to "withpaper.com".
   */
  useAltDomain?: boolean;
}

export function createCheckoutWithCardLink({
  sdkClientSecret,
  appName,
  options = { ...DEFAULT_BRAND_OPTIONS },
  locale,
  configs,
}: CheckoutWithCardLinkArgs) {
  const CheckoutWithCardUrlBase = new URL(
    CHECKOUT_WITH_CARD_IFRAME_URL,
    PAPER_APP_URL,
  );

  const checkoutWithCardLink = new LinksManager(CheckoutWithCardUrlBase);
  checkoutWithCardLink.addClientSecret(sdkClientSecret ?? "");
  checkoutWithCardLink.addStylingOptions(options);
  checkoutWithCardLink.addLocale(locale);
  checkoutWithCardLink.addAppName(appName);

  return checkoutWithCardLink.getLink();
}

export interface CheckoutWithCardMessageHandlerArgs {
  iframe: HTMLIFrameElement;
  onPaymentSuccess?: ({ id }: { id: string }) => void;
  onReview?: (result: ReviewResult) => void;
  onError?: (error: PaperSDKError) => void;
  onOpenKycModal?: (props: KycModal) => void;
  onCloseKycModal?: () => void;
  onBeforeModalOpen?: (props: { url: string }) => void;
  onPriceUpdate?: (props: PriceSummary) => void;
  useAltDomain?: boolean;
}

export function createCheckoutWithCardMessageHandler({
  iframe,
  onError,
  onReview,
  onPaymentSuccess,
  onBeforeModalOpen,
  onPriceUpdate,
}: CheckoutWithCardMessageHandlerArgs) {
  let modal: Modal;

  return (event: MessageEvent) => {
    if (!event.origin.startsWith(PAPER_APP_URL)) {
      return;
    }

    const { data } = event;
    switch (data.eventType) {
      case "checkoutWithCardError":
        if (onError) {
          onError({
            code: data.code as PaperSDKErrorCode,
            error: data.error,
          });
        }
        break;

      case "paymentSuccess":
        if (onPaymentSuccess) {
          onPaymentSuccess({ id: data.id });
        }

        if (data.postToIframe) {
          postMessageToIframe(iframe, data.eventType, data);
        }
        break;

      case "reviewComplete":
        if (onReview) {
          onReview({
            id: data.id,
            cardholderName: data.cardholderName,
          });
        }
        break;

      case "openModalWithUrl":
        if (
          onBeforeModalOpen &&
          data.url &&
          data.url.includes("promptKYCModal")
        ) {
          onBeforeModalOpen({
            url: data.url,
          });
        } else {
          modal = new Modal(undefined, {
            body: {
              colorScheme: "light",
            },
          });
          modal.open({ iframeUrl: data.url });
        }
        break;

      case "completedSDKModal":
        modal.close();
        if (data.postToIframe) {
          postMessageToIframe(iframe, data.eventType, data);
        }
        break;

      case "requestedPopup": {
        // The iframe requested a popup.
        // The reference to this window is not stored so the popup cannot
        // be programmatically closed.
        const popupRef = openCenteredPopup({
          url: data.url,
          width: data.width,
          height: data.height,
        });
        if (!popupRef) {
          console.error("CheckoutWithCard: Unable to open popup.");
        }
        break;
      }

      case "sizing":
        iframe.style.height = data.height + "px";
        iframe.style.maxHeight = data.height + "px";
        break;

      case "onPriceUpdate": {
        const { quantity, unitPrice, networkFees, serviceFees, total } = data;
        onPriceUpdate?.({
          quantity,
          unitPrice,
          networkFees,
          serviceFees,
          total,
        });
        break;
      }

      default:
      // Ignore unrecognized event
    }
  };
}

export type CheckoutWithCardElementArgs = Omit<
  CheckoutWithCardMessageHandlerArgs,
  "iframe"
> &
  CheckoutWithCardLinkArgs &
  PaperPaymentElementConstructorArgs;

export function createCheckoutWithCardElement({
  onCloseKycModal,
  onOpenKycModal,
  sdkClientSecret,
  appName,
  elementOrId,
  onLoad,
  onError,
  locale,
  options,
  onPaymentSuccess,
  onReview,
  onBeforeModalOpen,
  onPriceUpdate,
  useAltDomain = true,
  configs,
}: CheckoutWithCardElementArgs) {
  let clientSecret = sdkClientSecret;
  if (!clientSecret && configs) {
    clientSecret = btoa(JSON.stringify(configs));
  }
  if (!clientSecret) {
    const error = `Must have either sdkClientSecret or configs field set. Received neither`;
    throw new Error(error);
  }

  const checkoutWithCardId = "checkout-with-card-iframe";
  const checkoutWithCardMessageHandler = (iframe: HTMLIFrameElement) =>
    createCheckoutWithCardMessageHandler({
      iframe,
      onCloseKycModal,
      onOpenKycModal,
      onError,
      onPaymentSuccess,
      onReview,
      onBeforeModalOpen,
      onPriceUpdate,
      useAltDomain,
    });

  const checkoutWithCardUrl = createCheckoutWithCardLink({
    sdkClientSecret: clientSecret,
    appName,
    locale,
    options,
    useAltDomain,
  });

  const paymentElement = new PaperPaymentElement({
    onLoad,
    elementOrId,
  });
  return paymentElement.createPaymentElement({
    handler: checkoutWithCardMessageHandler,
    iframeId: checkoutWithCardId,
    link: checkoutWithCardUrl,
  });
}
