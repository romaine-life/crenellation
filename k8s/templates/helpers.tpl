{{- define "crenellation.renderMode" -}}
{{- $mode := .Values.renderMode | default "normal" -}}
{{- if not (has $mode (list "normal" "warm" "hot")) -}}
{{- fail (printf "renderMode must be one of: normal, warm, hot; got %q" $mode) -}}
{{- end -}}
{{- $mode -}}
{{- end -}}

{{- define "crenellation.isTestEnv" -}}
{{- $mode := include "crenellation.renderMode" . -}}
{{- if or (eq $mode "warm") (eq $mode "hot") -}}true{{- else -}}false{{- end -}}
{{- end -}}

{{- define "crenellation.renderWarm" -}}
{{- $mode := include "crenellation.renderMode" . -}}
{{- if or (eq $mode "normal") (eq $mode "warm") -}}true{{- else -}}false{{- end -}}
{{- end -}}

{{- define "crenellation.renderHot" -}}
{{- $mode := include "crenellation.renderMode" . -}}
{{- if or (eq $mode "normal") (eq $mode "hot") -}}true{{- else -}}false{{- end -}}
{{- end -}}

{{- define "crenellation.resourceName" -}}
{{- if eq (include "crenellation.isTestEnv" .) "true" -}}
{{- required "testEnv.slotName is required when renderMode is warm or hot" .Values.testEnv.slotName -}}
{{- else -}}
{{- .Values.name | default "crenellation" -}}
{{- end -}}
{{- end -}}

{{- define "crenellation.namespace" -}}
{{- if eq (include "crenellation.isTestEnv" .) "true" -}}
{{- .Release.Namespace -}}
{{- else -}}
{{- .Values.namespace | default .Release.Namespace -}}
{{- end -}}
{{- end -}}

{{/*
crenellation.appPortName — the backend container's served port name. When a
live-preview edge fronts the backend (livePreview.enabled), the edge owns the
"http" served port, so the backend's own port is renamed to an internal name to
avoid a duplicate port name in the pod; the Service then targets the edge via
live-preview-edge.servedPortName. Without the edge it stays "http", so normal /
prod / validation renders are byte-identical. This helper is defined locally
(not in the vendored live-preview-edge partial) so it is always available, even
on renders where the partial is absent (livePreview off).
*/}}
{{- define "crenellation.appPortName" -}}
{{- if .Values.livePreview.enabled -}}app-internal{{- else -}}http{{- end -}}
{{- end -}}
