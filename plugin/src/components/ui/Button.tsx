import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: 'ghost2' | 'primary' | 'default';
	size?: 'fit' | 'icon' | 'sm' | 'md';
	children: React.ReactNode;
}

export const Button = ({
	variant = 'ghost2',
	size = 'fit',
	className = '',
	children,
	...props
}: ButtonProps) => {
	const baseClasses = 'tw-inline-flex tw-items-center tw-justify-center tw-border-0 tw-bg-transparent tw-text-muted tw-p-0 tw-m-0';

	const hoverClasses = 'hover:tw-text-accent';

	const sizeClasses = {
		fit: 'tw-px-1 tw-py-1',
		icon: 'tw-h-auto tw-w-auto tw-p-1',
		sm: 'tw-h-8 tw-px-3',
		md: 'tw-h-10 tw-px-4 tw-py-2'
	};

	const classes = `${baseClasses} ${hoverClasses} ${sizeClasses[size]} ${className}`;

	return (
		<button className={classes} {...props}>
			{children}
		</button>
	);
};