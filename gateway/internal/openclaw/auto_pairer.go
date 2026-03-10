package openclaw

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
)

const (
	defaultPollInterval = 2 * time.Second
	defaultPollDuration = 20 * time.Second
)

// AutoPairer connects to an OpenClaw container and auto-approves
// any pending device pair requests over a configurable polling window.
type AutoPairer struct {
	wsURL    string
	token    string
	interval time.Duration
	duration time.Duration
}

// NewAutoPairer creates an AutoPairer with default polling settings.
func NewAutoPairer(wsURL, token string) *AutoPairer {
	return &AutoPairer{
		wsURL:    wsURL,
		token:    token,
		interval: defaultPollInterval,
		duration: defaultPollDuration,
	}
}

// WithInterval sets the polling interval between pair list checks.
func (ap *AutoPairer) WithInterval(d time.Duration) *AutoPairer {
	ap.interval = d
	return ap
}

// WithDuration sets the total polling window duration.
func (ap *AutoPairer) WithDuration(d time.Duration) *AutoPairer {
	ap.duration = d
	return ap
}

// ApproveAll connects to the container, polls for pending pair requests
// for the configured duration, and approves any it finds.
// Returns nil when the polling window ends with no errors.
func (ap *AutoPairer) ApproveAll(ctx context.Context) error {
	connectCtx, cancel := context.WithTimeout(ctx, defaultConnectTimeout)
	defer cancel()

	client, err := NewGatewayClient(connectCtx, ap.wsURL, ap.token)
	if err != nil {
		return err
	}
	defer client.Close()

	log.Info().Str("url", ap.wsURL).Dur("duration", ap.duration).Msg("auto-pairer: started polling")

	deadline := time.After(ap.duration)
	ticker := time.NewTicker(ap.interval)
	defer ticker.Stop()

	approved := 0

	for {
		if err := ap.pollOnce(ctx, client, &approved); err != nil {
			if IsMissingScope(err, "operator.pairing") {
				log.Info().Err(err).Msg("auto-pairer: token missing operator.pairing scope; stop polling")
				return nil
			}
			log.Warn().Err(err).Msg("auto-pairer: poll error")
		}

		select {
		case <-deadline:
			log.Info().Int("approved", approved).Msg("auto-pairer: polling complete")
			return nil
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (ap *AutoPairer) pollOnce(ctx context.Context, client *GatewayClient, approved *int) error {
	pairs, err := client.ListPendingPairs(ctx)
	if err != nil {
		return err
	}

	for _, p := range pairs {
		log.Info().Str("pairing_id", p.PairingID).Str("name", p.Name).Msg("auto-pairer: approving pair request")

		if err := client.ApprovePair(ctx, p.PairingID); err != nil {
			if IsMissingScope(err, "operator.pairing") {
				return err
			}
			log.Error().Err(err).Str("pairing_id", p.PairingID).Msg("auto-pairer: approve failed")
			continue
		}
		*approved++
		log.Info().Str("pairing_id", p.PairingID).Msg("auto-pairer: pair approved")
	}
	return nil
}
