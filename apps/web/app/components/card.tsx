import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type CardProps = ComponentProps<'div'>;

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[12] border border-[#1F232C] bg-[#111318] p-5 ',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
