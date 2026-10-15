module github.com/ai-grid-cloud/ai-grid-provider-console/bff

go 1.26.3

require google.golang.org/grpc v1.84.0

require google.golang.org/genproto/googleapis/rpc v0.0.0-20260706201446-f0a921348800 // indirect

require (
	github.com/osac-project/ai-grid-backend v0.0.0-20261014173018-fb419b32653d
	golang.org/x/net v0.57.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.40.0 // indirect
	google.golang.org/protobuf v1.36.12-0.20260120151049-f2248ac996af // indirect
)

// The backend declares the osac-project module path but lives under yuvalturg
// for now. Drop the replace when the repository moves.
replace github.com/osac-project/ai-grid-backend => github.com/yuvalturg/ai-grid-backend v0.0.0-20261014173018-fb419b32653d
