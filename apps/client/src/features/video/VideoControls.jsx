import Button from '../../shared/ui/Button.jsx';
import IconButton from '../../shared/ui/IconButton.jsx';
import { MicIcon, MicOffIcon, CameraIcon, CameraOffIcon } from '../../shared/ui/icons.jsx';

export default function VideoControls({
  micOn,
  cameraOn,
  onToggleMic,
  onToggleCamera,
  onNext,
  onLeave,
  disabled = false,
}) {
  return (
    <div className="call-controls">
      <div className="call-controls__toggles">
        <IconButton
          icon={micOn ? <MicIcon /> : <MicOffIcon />}
          label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          active={micOn}
          toggle
          onClick={onToggleMic}
        />
        <IconButton
          icon={cameraOn ? <CameraIcon /> : <CameraOffIcon />}
          label={cameraOn ? 'Turn off camera' : 'Turn on camera'}
          active={cameraOn}
          toggle
          onClick={onToggleCamera}
        />
      </div>

      <div className="call-controls__actions">
        <Button variant="secondary" onClick={onNext} disabled={disabled}>
          Next
        </Button>
        <Button variant="danger" onClick={onLeave}>
          Leave
        </Button>
      </div>
    </div>
  );
}
