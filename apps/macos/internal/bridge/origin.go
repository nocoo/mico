package bridge

import (
	"net/url"
	"strings"
)

type OriginPolicy struct {
	extraExact    map[string]struct{}
	extraSuffixes []string
}

func NewOriginPolicy(extraCSV string) *OriginPolicy {
	p := &OriginPolicy{
		extraExact: make(map[string]struct{}),
	}
	for raw := range strings.SplitSeq(extraCSV, ",") {
		entry := strings.TrimSpace(raw)
		if entry == "" {
			continue
		}
		if strings.HasPrefix(entry, "https://*.") {
			suffix := strings.ToLower(strings.TrimPrefix(entry, "https://*"))
			if len(suffix) > 1 {
				p.extraSuffixes = append(p.extraSuffixes, suffix)
			}
			continue
		}
		if u, err := url.Parse(entry); err == nil && u.Scheme != "" && u.Host != "" {
			p.extraExact[strings.ToLower(u.Scheme+"://"+u.Host)] = struct{}{}
		}
	}
	return p
}

func (p *OriginPolicy) Allowed(origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return true
	}
	if scheme == "https" && strings.HasSuffix(host, ".azurecontainerapps.io") && len(host) > len(".azurecontainerapps.io") {
		return true
	}
	if p != nil {
		key := scheme + "://" + strings.ToLower(u.Host)
		if _, ok := p.extraExact[key]; ok {
			return true
		}
		if scheme == "https" {
			for _, suffix := range p.extraSuffixes {
				if strings.HasSuffix(host, suffix) && len(host) > len(suffix) {
					return true
				}
			}
		}
	}
	return false
}
