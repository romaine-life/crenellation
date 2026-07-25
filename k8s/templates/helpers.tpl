{{- define "chess-tactics.renderMode" -}}
{{- $mode := .Values.renderMode | default "normal" -}}
{{- if not (has $mode (list "normal" "warm" "hot")) -}}
{{- fail (printf "renderMode must be one of: normal, warm, hot; got %q" $mode) -}}
{{- end -}}
{{- $mode -}}
{{- end -}}

{{- define "chess-tactics.isTestEnv" -}}
{{- $mode := include "chess-tactics.renderMode" . -}}
{{- if or (eq $mode "warm") (eq $mode "hot") -}}true{{- else -}}false{{- end -}}
{{- end -}}

{{- define "chess-tactics.renderWarm" -}}
{{- $mode := include "chess-tactics.renderMode" . -}}
{{- if or (eq $mode "normal") (eq $mode "warm") -}}true{{- else -}}false{{- end -}}
{{- end -}}

{{- define "chess-tactics.renderHot" -}}
{{- $mode := include "chess-tactics.renderMode" . -}}
{{- if or (eq $mode "normal") (eq $mode "hot") -}}true{{- else -}}false{{- end -}}
{{- end -}}

{{- define "chess-tactics.resourceName" -}}
{{- if eq (include "chess-tactics.isTestEnv" .) "true" -}}
{{- required "testEnv.slotName is required when renderMode is warm or hot" .Values.testEnv.slotName -}}
{{- else -}}
{{- .Values.name | default "chess-tactics" -}}
{{- end -}}
{{- end -}}

{{- define "chess-tactics.namespace" -}}
{{- if eq (include "chess-tactics.isTestEnv" .) "true" -}}
{{- .Release.Namespace -}}
{{- else -}}
{{- .Values.namespace | default .Release.Namespace -}}
{{- end -}}
{{- end -}}

{{/*
chess-tactics.appPortName — the backend container's served port name. When a
live-preview edge fronts the backend (livePreview.enabled), the edge owns the
"http" served port, so the backend's own port is renamed to an internal name to
avoid a duplicate port name in the pod; the Service then targets the edge via
live-preview-edge.servedPortName. Without the edge it stays "http", so normal /
prod / validation renders are byte-identical. This helper is defined locally
(not in the vendored live-preview-edge partial) so it is always available, even
on renders where the partial is absent (livePreview off).
*/}}
{{- define "chess-tactics.appPortName" -}}
{{- if .Values.livePreview.enabled -}}app-internal{{- else -}}http{{- end -}}
{{- end -}}
