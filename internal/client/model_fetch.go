package client

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// ModelListRequest defines the request used to fetch model IDs from a provider endpoint.
type ModelListRequest struct {
	APIType string `json:"apiType"`
	BaseURL string `json:"baseURL"`
	APIKey  string `json:"apiKey"`
}

// ModelListResult defines the normalized model list response returned to the UI.
type ModelListResult struct {
	BaseURL           string   `json:"baseURL"`
	ModelsEndpointURL string   `json:"modelsEndpointURL"`
	ModelIDs          []string `json:"modelIDs"`
}

type modelListResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

func normalizeModelListBaseURL(value string) (string, error) {
	text := strings.TrimRight(strings.TrimSpace(value), "/")
	if text == "" {
		return "", fmt.Errorf("base URL is required")
	}

	parsed, err := url.Parse(text)
	if err != nil {
		return "", fmt.Errorf("invalid base URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("base URL must start with http or https")
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("base URL is missing host")
	}

	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.Path = strings.TrimSuffix(parsed.Path, "/models")
	return strings.TrimRight(parsed.String(), "/"), nil
}

func buildModelListEndpoint(baseURL string) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/models"
	return strings.TrimRight(parsed.String(), "/"), nil
}

func normalizeModelListAPIType(value string) string {
	apiType := strings.ToLower(strings.TrimSpace(value))
	if apiType == "anthropic" {
		return "anthropic"
	}
	return "openai"
}

// FetchModelIDs fetches an OpenAI-compatible model list through Go instead of the WebView.
// This avoids browser/WebView CORS and local-network restrictions for endpoints like 127.0.0.1.
func (s *ProxyService) FetchModelIDs(req ModelListRequest) (ModelListResult, error) {
	baseURL, err := normalizeModelListBaseURL(req.BaseURL)
	if err != nil {
		return ModelListResult{}, err
	}
	apiKey := strings.TrimSpace(req.APIKey)
	if apiKey == "" {
		return ModelListResult{}, fmt.Errorf("API key is required")
	}
	endpointURL, err := buildModelListEndpoint(baseURL)
	if err != nil {
		return ModelListResult{}, fmt.Errorf("invalid models endpoint URL: %w", err)
	}

	httpReq, err := http.NewRequest(http.MethodGet, endpointURL, nil)
	if err != nil {
		return ModelListResult{}, err
	}
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	if normalizeModelListAPIType(req.APIType) == "anthropic" {
		httpReq.Header.Set("x-api-key", apiKey)
		httpReq.Header.Set("anthropic-version", "2023-06-01")
	}

	client := s.publicClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return ModelListResult{}, fmt.Errorf("failed to fetch models from %s: %w", endpointURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ModelListResult{}, fmt.Errorf("failed to fetch models from %s: HTTP %d", endpointURL, resp.StatusCode)
	}

	var payload modelListResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return ModelListResult{}, fmt.Errorf("failed to parse models response: %w", err)
	}

	seen := make(map[string]struct{})
	modelIDs := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		modelIDs = append(modelIDs, id)
	}
	if len(modelIDs) == 0 {
		return ModelListResult{}, fmt.Errorf("no model IDs found in the models response")
	}

	return ModelListResult{
		BaseURL:           baseURL,
		ModelsEndpointURL: endpointURL,
		ModelIDs:          modelIDs,
	}, nil
}
