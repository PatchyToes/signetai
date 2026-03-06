const { existsSync } = require("node:fs");
const { join } = require("node:path");

const triples = {
	"linux-x64-gnu": "signet-native.linux-x64-gnu.node",
	"linux-x64-musl": "signet-native.linux-x64-musl.node",
	"darwin-x64": "signet-native.darwin-x64.node",
	"darwin-arm64": "signet-native.darwin-arm64.node",
	"win32-x64-msvc": "signet-native.win32-x64-msvc.node",
};

function loadBinding() {
	const { platform, arch } = process;
	const musl =
		platform === "linux" &&
		existsSync("/etc/alpine-release") ? "-musl" : "-gnu";
	const key =
		platform === "linux"
			? `${platform}-${arch}${musl}`
			: `${platform}-${arch}`;
	const file = triples[key];
	if (!file) {
		throw new Error(`Unsupported platform: ${key}`);
	}
	const bindingPath = join(__dirname, file);
	if (!existsSync(bindingPath)) {
		throw new Error(`Native binding not found: ${bindingPath}`);
	}
	return require(bindingPath);
}

module.exports = loadBinding();
