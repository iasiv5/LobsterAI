export const HtmlShareIpc = {
  CreateFromHtmlFile: 'htmlShare:createFromHtmlFile',
  UpdateFromHtmlFile: 'htmlShare:updateFromHtmlFile',
  GetByHtmlFile: 'htmlShare:getByHtmlFile',
  UpdateStatus: 'htmlShare:updateStatus',
  Disable: 'htmlShare:disable',
  Get: 'htmlShare:get',
} as const;

export type HtmlShareIpc = (typeof HtmlShareIpc)[keyof typeof HtmlShareIpc];

export const HtmlShareSourceType = {
  HtmlFile: 'html_file',
} as const;

export type HtmlShareSourceType = (typeof HtmlShareSourceType)[keyof typeof HtmlShareSourceType];

export const HtmlShareAccessMode = {
  Code: 'code',
} as const;

export type HtmlShareAccessMode = (typeof HtmlShareAccessMode)[keyof typeof HtmlShareAccessMode];

export const HtmlShareStatus = {
  Live: 'live',
  Disabled: 'disabled',
  Failed: 'failed',
} as const;

export type HtmlShareStatus = (typeof HtmlShareStatus)[keyof typeof HtmlShareStatus];
export type HtmlShareConfigurableStatus =
  | typeof HtmlShareStatus.Live
  | typeof HtmlShareStatus.Disabled;

export const HtmlShareErrorCode = {
  ReopenUnavailable: 41304,
  SubscriptionRequired: 41307,
  AccessCodeInvalid: 41308,
  AccessCodeRateLimited: 41309,
  AccessModeInvalid: 41310,
  ActiveShareLimitReached: 41311,
  FeatureUnavailable: 49001,
  DisabledCannotUpdate: 49002,
} as const;

export const HtmlSharePublicRoute = {
  Root: '/s',
} as const;

export type HtmlSharePublicRoute = (typeof HtmlSharePublicRoute)[keyof typeof HtmlSharePublicRoute];
