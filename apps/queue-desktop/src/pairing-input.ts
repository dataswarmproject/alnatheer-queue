import { z } from 'zod';
import { branchTrustSchema, validateBranchTrust } from '@saraf/queue-core/branch-tls';

export function parseDevicePairing(text: string) {
  if (Buffer.byteLength(text, 'utf8') > 16384)
    throw new Error('ملف الاقتران أكبر من الحجم المسموح.');
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('تعذر قراءة ملف الاقتران. استخدم ملف JSON الأصلي الذي حفظه المدير.');
  }
  if (
    value &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'saraf-branch-identity'
  )
    throw new Error(
      'هذا ملف معرّف الفرع، وليس ملف اقتران جهاز. أصدر ملف موظف كاونتر من إعدادات المدير.',
    );
  const result = z
    .object({
      url: z.string().trim().min(1).max(200),
      token: z
        .string()
        .trim()
        .regex(/^[a-f0-9]{64}$/),
      trust: branchTrustSchema.optional(),
    })
    .safeParse(value);
  if (!result.success)
    throw new Error(
      'ملف الاقتران لا يحتوي عنوان الخادم ومفتاح جهاز صالحًا من 64 خانة. أعد تصديره من «إنشاء وربط الأجهزة».',
    );
  if (result.data.trust) validateBranchTrust(result.data.trust);
  return result.data;
}

export function connectionFailure(error: unknown, address: string): Error {
  const failure = error as { code?: string; name?: string; cause?: { code?: string } };
  const code = failure?.cause?.code ?? failure?.code ?? '';
  if (code === 'EPROTO' || code.startsWith('ERR_SSL_'))
    return new Error(
      'تعذر إتمام اتصال HTTPS. تحقق من تشغيل TLS على عنوان خادم الفرع والمنفذ الصحيحين.',
    );
  if (
    [
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'CERT_HAS_EXPIRED',
      'CERT_NOT_YET_VALID',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    ].includes(code)
  )
    return new Error(
      'تعذر التحقق من شهادة خادم الفرع. تحقق من ثقة الشهادة وتاريخ الجهاز ومطابقة اسم الخادم للشهادة.',
    );
  if (
    [
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ECONNRESET',
      'ABORT_ERR',
    ].includes(code) ||
    failure?.name === 'TimeoutError'
  ) {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(address).hostname);
    return new Error(
      local
        ? 'تعذر الاتصال بالعنوان المحلي. 127.0.0.1 يعمل على كمبيوتر الخادم فقط؛ لأجهزة الموظفين اطلب ملف اقتران بعنوان HTTPS للفرع عبر الشبكة.'
        : 'تعذر الوصول إلى خادم الفرع. تحقق من العنوان والمنفذ وشبكة LAN/VPN والجدار الناري وتشغيل الخادم.',
    );
  }
  return error instanceof Error ? error : new Error('تعذر الاتصال بخادم الفرع.');
}
