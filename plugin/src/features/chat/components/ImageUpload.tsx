import { useRef } from 'react';

interface ImageUploadProps {
	images: string[];
	onChange: (images: string[]) => void;
	onRemove: (image: string) => void;
}

export const ImageUpload = ({ images, onChange, onRemove }: ImageUploadProps) => {
	const inputRef = useRef<HTMLInputElement>(null);

	const handleSelectFiles = async (files: FileList | null) => {
		if (!files?.length) return;
		const encoded: string[] = [];
		for (const file of Array.from(files)) {
			// eslint-disable-next-line no-await-in-loop
			const base64 = await fileToBase64(file);
			encoded.push(base64);
		}
		onChange([...images, ...encoded]);
		if (inputRef.current) {
			inputRef.current.value = '';
		}
	};

	return (
		<div className="image-upload-trigger tw-flex tw-flex-col tw-gap-2">
			<input
				type="file"
				ref={inputRef}
				accept="image/*"
				multiple
				className="hidden"
				onChange={(event) => handleSelectFiles(event.target.files)}
			/>
			<button type="button" className="chat-btn" onClick={() => inputRef.current?.click()}>
				选择图片
			</button>
			{images.length > 0 && (
				<div className="selected-images tw-flex tw-flex-wrap tw-gap-2">
					{images.map((image, index) => (
						<div key={image} className="image-preview-container">
							<img src={image} alt={`selected-${index}`} className="selected-image-preview" />
							<button type="button" className="remove-image-button" onClick={() => onRemove(image)}>
								×
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
};

const fileToBase64 = (file: File): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});

