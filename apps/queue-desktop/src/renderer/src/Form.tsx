import { useId, useState, type FormHTMLAttributes } from 'react';

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Issue = { control: Control; message: string };

function message(control: Control) {
  const label =
    control.dataset.validationLabel ||
    control.getAttribute('aria-label') ||
    Array.from(control.labels?.[0]?.childNodes ?? [])
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent?.trim())
      .join(' ')
      .trim() ||
    'هذا الحقل';
  const validity = control.validity;
  if (validity.valueMissing) return `أكمل حقل «${label}».`;
  if (validity.typeMismatch)
    return `أدخل عنوانًا كاملًا في «${label}»، مثل https://branch-server:4318.`;
  if (validity.patternMismatch) return control.title || `تحقق من صيغة «${label}».`;
  if (control instanceof HTMLInputElement && (validity.rangeUnderflow || validity.rangeOverflow))
    return `أدخل قيمة بين ${control.min} و${control.max} في «${label}».`;
  if (validity.badInput || validity.stepMismatch) return `أدخل رقمًا صحيحًا في «${label}».`;
  return `تحقق من قيمة «${label}».`;
}

/** Keep native input constraints, but present errors in the application's language. */
export function Form({
  onSubmit,
  onChangeCapture,
  children,
  ...props
}: FormHTMLAttributes<HTMLFormElement>) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const summaryId = useId();
  return (
    <form
      {...props}
      noValidate
      data-validation-active={issues.length > 0 || undefined}
      aria-describedby={issues.length ? summaryId : props['aria-describedby']}
      onChangeCapture={event => {
        setIssues(previous => previous.filter(issue => issue.control !== event.target));
        onChangeCapture?.(event);
      }}
      onSubmit={event => {
        event.preventDefault();
        const invalid = Array.from(event.currentTarget.elements)
          .filter(
            (element): element is Control =>
              element instanceof HTMLInputElement ||
              element instanceof HTMLSelectElement ||
              element instanceof HTMLTextAreaElement,
          )
          .filter(control => control.willValidate && !control.validity.valid)
          .map(control => ({ control, message: message(control) }));
        setIssues(invalid);
        if (invalid.length) invalid[0].control.focus();
        else onSubmit?.(event);
      }}
    >
      {issues.length > 0 && (
        <div className="form-validation" id={summaryId} role="alert">
          <strong>راجع الحقول التالية</strong>
          <ul>
            {issues.map((issue, index) => (
              <li key={index}>
                <button type="button" onClick={() => issue.control.focus()}>
                  {issue.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {children}
    </form>
  );
}
