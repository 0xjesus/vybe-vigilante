function luminance(r, g, b) {
	let a = [ r, g, b ].map(v => {
		v /= 255;
		return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
	});
	return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function getContrastColor(hex) {
	let r = parseInt(hex.substring(1, 3), 16);
	let g = parseInt(hex.substring(3, 5), 16);
	let b = parseInt(hex.substring(5, 7), 16);

	let lumWhite = luminance(255, 255, 255);
	let lumBlack = luminance(0, 0, 0);
	let lumBg = luminance(r, g, b);

	let contrastWhite = (lumWhite + 0.05) / (lumBg + 0.05);
	let contrastBlack = (lumBg + 0.05) / (lumBlack + 0.05);

	return contrastWhite > contrastBlack ? '#FFFFFF' : '#000000';
}

export { getContrastColor };