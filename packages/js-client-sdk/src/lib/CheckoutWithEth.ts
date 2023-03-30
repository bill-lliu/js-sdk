/* eslint-disable @typescript-eslint/restrict-plus-operands */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type { ethers } from "ethers";
import {
  CHECKOUT_WITH_ETH_IFRAME_URL,
  DEFAULT_BRAND_OPTIONS,
  PAPER_APP_URL,
} from "../constants/settings";
import type {
  ICustomizationOptions,
  Locale,
} from "../interfaces/CommonCheckoutElementTypes";
import type { PaperSDKError } from "../interfaces/PaperSDKError";
import { PayWithCryptoErrorCode } from "../interfaces/PaperSDKError";
import { getSignerInfo } from "../utils/getSigner";
import { handlePayWithCryptoError } from "../utils/handleCheckoutWithEthError";
import { LinksManager } from "../utils/LinksManager";
import { postMessageToIframe } from "../utils/postMessageToIframe";
import type { PaperPaymentElementConstructorArgs } from "./CreatePaymentElement";
import { PaperPaymentElement } from "./CreatePaymentElement";

export const PAY_WITH_ETH_ERROR = "payWithEthError";

let isPaying = false;

export async function checkAndSendEth({
  data,
  iframe,
  payingWalletSigner,
  suppressErrorToast,
  onError,
  onSuccess,
}: {
  payingWalletSigner: ethers.Signer;
  data: {
    chainId: number;
    chainName: string;
    blob: string;
    paymentAddress: string;
    value: string;
    transactionId: string;
  };
  suppressErrorToast: boolean;
  iframe: HTMLIFrameElement;
  onSuccess?: ({
    transactionResponse,
    transactionId,
  }: {
    transactionResponse: ethers.providers.TransactionResponse;
    transactionId: string;
  }) => void;
  onError?: (error: PaperSDKError) => void;
}) {
  try {
    const chainId = await payingWalletSigner.getChainId();
    if (chainId !== data.chainId) {
      throw {
        isErrorObject: true,
        title: PayWithCryptoErrorCode.WrongChain,
        description: `Please change to ${data.chainName} to proceed.`,
      };
    }
  } catch (e) {
    handlePayWithCryptoError(e as Error, onError, (errorObject) => {
      postMessageToIframe(iframe, PAY_WITH_ETH_ERROR, {
        error: errorObject,
        suppressErrorToast,
      });
    });
    return;
  }

  // send the transaction
  try {
    console.log("sending funds");
    if (isPaying) {
      return;
    }
    isPaying = true;
    const { sendTransaction, prepareSendTransaction } = await import(
      "@wagmi/core"
    );
    const config = await prepareSendTransaction({
      request: {
        chainId: data.chainId,
        data: data.blob,
        to: data.paymentAddress,
        value: data.value,
      },
    });
    const result = await sendTransaction(config);

    if (onSuccess && result) {
      if (!payingWalletSigner.provider) {
        throw new Error("Missing provider for signer");
      }
      const response = await payingWalletSigner.provider.getTransaction(
        result.hash,
      );
      onSuccess({
        transactionResponse: response,
        transactionId: data.transactionId,
      });
    }
    if (result) {
      postMessageToIframe(iframe, "paymentSuccess", {
        suppressErrorToast,
        transactionHash: result.hash,
      });
    }
    isPaying = false;
  } catch (error) {
    isPaying = false;
    console.log("error sending funds", error);
    handlePayWithCryptoError(error as Error, onError, (errorObject) => {
      postMessageToIframe(iframe, PAY_WITH_ETH_ERROR, {
        error: errorObject,
        suppressErrorToast,
      });
    });
  }
}

export interface CheckoutWithEthMessageHandlerArgs {
  iframe: HTMLIFrameElement;
  onSuccess?: ({
    transactionResponse,
    transactionId,
  }: {
    transactionResponse: ethers.providers.TransactionResponse;
    transactionId: string;
  }) => void;
  onError?: (error: PaperSDKError) => void;
  suppressErrorToast?: boolean;
  setUpUserPayingWalletSigner?: (args: {
    chainId: number;
    chainName?: string;
  }) => void | Promise<void>;
  payingWalletSigner: ethers.Signer;
  onGoBackToChooseWallet?: () => void;
}

export function createCheckoutWithEthMessageHandler({
  iframe,
  onError,
  onSuccess,
  suppressErrorToast = false,
  setUpUserPayingWalletSigner,
  payingWalletSigner,
  onGoBackToChooseWallet,
}: CheckoutWithEthMessageHandlerArgs) {
  return async (event: MessageEvent) => {
    if (!event.origin.startsWith(PAPER_APP_URL)) {
      return;
    }
    const data = event.data;
    switch (data.eventType) {
      case "payWithEth": {
        if (data.error) {
          handlePayWithCryptoError(
            new Error(data.error),
            onError,
            (errorObject) => {
              postMessageToIframe(iframe, PAY_WITH_ETH_ERROR, {
                error: errorObject,
                suppressErrorToast,
              });
            },
          );
          return;
        }
        // Allows Dev's to inject any chain switching for their custom signer here.
        if (setUpUserPayingWalletSigner) {
          try {
            console.log("setting up signer");
            await setUpUserPayingWalletSigner({
              chainId: data.chainId,
              chainName: data.chainName,
            });
          } catch (error) {
            console.log("error setting up signer", error);
            handlePayWithCryptoError(error as Error, onError, (errorObject) => {
              postMessageToIframe(iframe, PAY_WITH_ETH_ERROR, {
                error: errorObject,
                suppressErrorToast,
              });
            });
            return;
          }
        }
        await checkAndSendEth({
          data,
          iframe,
          payingWalletSigner,
          suppressErrorToast,
          onError,
          onSuccess,
        });
        break;
      }
      case "checkout-with-eth-sizing": {
        iframe.style.height = data.height + "px";
        iframe.style.maxHeight = data.height + "px";
        break;
      }
      case "goBackToChoosingWallet": {
        onGoBackToChooseWallet?.();
        break;
      }
      default:
        break;
    }
  };
}

export interface CheckoutWithEthLinkArgs {
  sdkClientSecret: string;
  appName?: string;
  payingWalletSigner: ethers.Signer;
  receivingWalletType?:
    | "WalletConnect"
    | "MetaMask"
    | "Coinbase Wallet"
    | string;
  showConnectWalletOptions?: boolean;

  locale?: Locale;
  options?: ICustomizationOptions;
}

export async function createCheckoutWithEthLink({
  sdkClientSecret,
  payingWalletSigner,
  receivingWalletType,
  showConnectWalletOptions = false,
  appName,
  locale,
  options = {
    ...DEFAULT_BRAND_OPTIONS,
  },
}: CheckoutWithEthLinkArgs) {
  const checkoutWithEthUrlBase = new URL(
    CHECKOUT_WITH_ETH_IFRAME_URL,
    PAPER_APP_URL,
  );
  const address = await payingWalletSigner.getAddress();

  const checkoutWithEthLink = new LinksManager(checkoutWithEthUrlBase);
  checkoutWithEthLink.addClientSecret(sdkClientSecret);
  checkoutWithEthLink.addRecipientWalletAddress(address);
  checkoutWithEthLink.addPayerWalletAddress(address);
  checkoutWithEthLink.addReceivingWalletType(receivingWalletType);
  checkoutWithEthLink.addAppName(appName);
  checkoutWithEthLink.addShowConnectWalletOptions(showConnectWalletOptions);
  checkoutWithEthLink.addStylingOptions(options);
  checkoutWithEthLink.addLocale(locale);

  return checkoutWithEthLink.getLink();
}

export type CheckoutWithEthElementArgs = Omit<
  Omit<CheckoutWithEthMessageHandlerArgs, "iframe">,
  "setUpUserPayingWalletSigner"
> &
  CheckoutWithEthLinkArgs &
  PaperPaymentElementConstructorArgs;

export async function createCheckoutWithEthElement({
  sdkClientSecret,
  onSuccess,
  suppressErrorToast,
  onError,
  onLoad,
  payingWalletSigner,
  receivingWalletType,
  appName,
  showConnectWalletOptions,
  locale,
  options,
  elementOrId,
  onGoBackToChooseWallet,
}: CheckoutWithEthElementArgs): Promise<HTMLIFrameElement> {
  const checkoutWithEthId = "checkout-with-eth-iframe";
  const checkoutWithEthMessageHandler = (iframe: HTMLIFrameElement) =>
    createCheckoutWithEthMessageHandler({
      iframe,
      payingWalletSigner,
      onSuccess,
      onError,
      suppressErrorToast,
      onGoBackToChooseWallet,
    });
  const checkoutWithEthUrl = await createCheckoutWithEthLink({
    payingWalletSigner,
    sdkClientSecret,
    appName,
    locale,
    options,
    receivingWalletType,
    showConnectWalletOptions,
  });
  const paymentElement = new PaperPaymentElement({
    onLoad,
    elementOrId,
  });
  return paymentElement.createPaymentElement({
    handler: checkoutWithEthMessageHandler,
    iframeId: checkoutWithEthId,
    link: checkoutWithEthUrl,
  });
}

export async function renderCheckoutWithEth(
  args: Omit<CheckoutWithEthElementArgs, "payingWalletSigner"> &
    Partial<Pick<CheckoutWithEthElementArgs, "payingWalletSigner">>,
) {
  if (args.payingWalletSigner) {
    return createCheckoutWithEthElement({
      ...args,
      payingWalletSigner: args.payingWalletSigner,
    });
  }

  let container: HTMLElement | null;
  if (typeof args.elementOrId === "string") {
    container = document.getElementById(args.elementOrId);
    if (!container) {
      throw new Error("Invalid element ID given");
    }
  } else {
    container = args.elementOrId;
  }
  const result = await getSignerInfo({
    container,
    sdkClientSecret: args.sdkClientSecret,
    appName: args.appName,
  });
  if (result?.signer) {
    const { signer, walletType } = result;
    return createCheckoutWithEthElement({
      ...args,
      payingWalletSigner: signer,
      showConnectWalletOptions: true,
      receivingWalletType: walletType,
      onGoBackToChooseWallet: async () => {
        const { disconnect } = await import("@wagmi/core");
        await disconnect();
        if (container) {
          // remove the current iframe
          while (container.firstChild) {
            container.removeChild(container.firstChild);
          }
        }
        // Note that this ends up registering multiple event listeners
        await renderCheckoutWithEth(args);
      },
    });
  }
  return;
}