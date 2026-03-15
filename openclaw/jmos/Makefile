.PHONY: build dev clean image

build:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
	go build -ldflags="-s -w" -o bin/jmos ./cmd/jmos

dev:
	go run ./cmd/jmos --config config.yaml

# Copy binary to deploy/incus/ for golden image build
image: build
	cp bin/jmos ../../deploy/incus/jmos
	@echo "✅ bin/jmos → deploy/incus/jmos (ready for build-openclaw-image.sh)"

clean:
	rm -rf bin/
