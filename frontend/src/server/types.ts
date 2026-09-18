export type SheetValue = string | number | boolean | null;
export type SheetRow = Record<string, unknown>;

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: { code: string; message: string } };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export type ApiRequest = {
  token?: string;
  action?: string;
  params?: Record<string, unknown>;
  debug?: boolean | number;
};
