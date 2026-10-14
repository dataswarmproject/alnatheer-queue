import { forwardRef, type SelectHTMLAttributes } from 'react';
import { NavArrowDown } from 'iconoir-react';

// Geist styling with native select semantics and an RTL-aware Iconoir indicator.
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select(props, ref) {
    return (
      <span className="select-field" dir={props.dir}>
        <select {...props} ref={ref} />
        <NavArrowDown aria-hidden="true" />
      </span>
    );
  },
);
